// Mantém `produto_estoque` (controle por depósito) em sincronia com
// `produtos.estoque` (campo único, fonte de verdade histórica do sistema)
// nos fluxos que hoje só mexem no campo único — venda no PDV e entrada de
// mercadoria. Sem isso, os dois números divergem silenciosamente: o total
// "Estoque atual" muda a cada venda/entrada, mas o quadro por depósito no
// modal Estoque Detalhado fica parado, dando a impressão de erro no
// sistema quando na verdade é só uma tabela nunca atualizada.
//
// Usa o depósito marcado como `principal` da empresa — nenhum fluxo de
// venda ou entrada tem hoje uma tela para escolher OUTRO depósito, então
// espelhar no principal é o que mantém os dois números batendo sem exigir
// nenhuma mudança de tela. Empresas que realmente operam com múltiplos
// depósitos físicos (`permite_multiplos_depositos`) ainda vão precisar de
// uma tela própria de escolha de depósito por venda/entrada — isso é um
// projeto à parte, fora do escopo deste ajuste.
export async function ajustarDepositoPrincipal(
  sb: any, empresaId: string, produtoId: string, delta: number
): Promise<void> {
  if (delta === 0) return
  const { data: deposito } = await sb.from('depositos')
    .select('id').eq('empresa_id', empresaId).eq('principal', true).maybeSingle()
  if (!deposito) return

  const { data: pe } = await sb.from('produto_estoque')
    .select('quantidade').eq('deposito_id', deposito.id).eq('produto_id', produtoId).maybeSingle()

  if (pe) {
    await sb.from('produto_estoque').update({
      quantidade: Number(pe.quantidade) + delta,
      ultima_movimentacao: new Date().toISOString(),
    }).eq('deposito_id', deposito.id).eq('produto_id', produtoId)
  } else {
    await sb.from('produto_estoque').insert({
      empresa_id: empresaId, deposito_id: deposito.id, produto_id: produtoId, quantidade: delta,
    })
  }
}

/**
 * Contagem física: escreve o número CONTADO no depósito, em vez de somar a
 * diferença.
 *
 * Por que existe: somar a diferença só chega no número certo se o depósito já
 * estivesse certo antes. E não estava — `produto_estoque` passou a ser
 * alimentado por deltas quando o sistema já tinha estoque, e o saldo que
 * existia naquele momento nunca foi copiado para lá. Medido no dia deste
 * ajuste: 63 produtos com o depósito divergindo do estoque e 509 sem linha de
 * depósito nenhuma, de 1.000 ativos.
 *
 * O sintoma que isso produz é o pior tipo: o operador conta a prateleira, põe
 * 3, o topo da tela mostra 3, e o quadro por depósito mostra -3. Nenhum dos
 * dois números está errado por si — eles vêm de origens diferentes, e uma
 * delas nunca teve começo.
 *
 * Contagem é a informação mais confiável que existe sobre estoque: alguém foi
 * lá e contou. Então ela sobrescreve, não incrementa.
 *
 * Só faz isso quando há UM depósito ativo. Com dois ou mais, o total do
 * produto não diz quanto tem em cada um — aí a diferença continua sendo
 * aplicada no principal, que é o comportamento antigo, e a tela avisa.
 */
export async function definirContagemNoDeposito(
  sb: any, empresaId: string, produtoId: string, quantidadeContada: number,
): Promise<'definido' | 'varios_depositos' | 'sem_deposito'> {
  const { data: ativos } = await sb.from('depositos')
    .select('id, principal').eq('empresa_id', empresaId).eq('ativo', true)

  if (!ativos || ativos.length === 0) return 'sem_deposito'
  if (ativos.length > 1) return 'varios_depositos'

  const deposito = ativos[0]
  const { data: pe } = await sb.from('produto_estoque')
    .select('id').eq('deposito_id', deposito.id).eq('produto_id', produtoId).maybeSingle()

  if (pe) {
    await sb.from('produto_estoque').update({
      quantidade: quantidadeContada,
      ultima_movimentacao: new Date().toISOString(),
    }).eq('id', pe.id)
  } else {
    await sb.from('produto_estoque').insert({
      empresa_id: empresaId, deposito_id: deposito.id, produto_id: produtoId,
      quantidade: quantidadeContada,
    })
  }
  return 'definido'
}
