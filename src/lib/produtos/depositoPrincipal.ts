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
