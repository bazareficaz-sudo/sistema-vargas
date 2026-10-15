// Desfaz no estoque o que uma entrada manual fez — usado ao EXCLUIR (lista
// de entradas) e ao CANCELAR (tela da entrada).
//
// Antes, a reversão subtraía a quantidade de cada item e parava em zero.
// Isso errava em dois casos, e o primeiro deixou produto zerado na loja:
//
//  1. "Zerar estoque antes" — a entrada zera o saldo antigo e depois soma a
//     quantidade. Subtrair só a quantidade não devolve o que foi zerado:
//     tinha 10, a entrada duplicada zerou e somou 10 (ficou 10), a exclusão
//     tirou 10 → 0. O certo era voltar a 10.
//  2. O corte em zero escondia a diferença, e nada ia para o extrato: o
//     estoque mudava sem rastro.
//
// A regra agora: o que a entrada fez está registrado em estoque_movimentacoes
// com a referência dela. A soma de (estoque_novo − estoque_anterior) desses
// movimentos, por produto, é o efeito líquido da entrada; a reversão aplica o
// inverso e grava o próprio movimento COM A MESMA referência. Assim a
// operação é idempotente: rodar de novo soma zero e não mexe em nada.

import { registrarMovimentoEstoque } from '@/lib/produtos/movimentacao'
import { ajustarDepositoPrincipal } from '@/lib/produtos/depositoPrincipal'
import { recalcularKitsQueUsam } from '@/lib/produtos/kit'

export type MovimentoDaEntrada = {
  produto_id: string
  produto_nome?: string | null
  estoque_anterior: number | string | null
  estoque_novo: number | string | null
}

/** Efeito líquido da entrada no estoque, por produto (positivo = a entrada somou). */
export function efeitoLiquidoPorProduto(movimentos: MovimentoDaEntrada[]): Map<string, number> {
  const efeito = new Map<string, number>()
  for (const m of movimentos) {
    if (!m.produto_id) continue
    const delta = Number(m.estoque_novo ?? 0) - Number(m.estoque_anterior ?? 0)
    efeito.set(m.produto_id, (efeito.get(m.produto_id) ?? 0) + delta)
  }
  // Arredonda a 3 casas (a precisão do banco) para 0,1 + 0,2 não sobrar.
  for (const [id, v] of efeito) efeito.set(id, Math.round(v * 1000) / 1000)
  return efeito
}

/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase sem tipos gerados, como no resto de lib/ */

/**
 * Soma `delta` ao estoque do produto por conta de uma entrada: cadastro,
 * depósito principal, extrato (com a referência da entrada) e kits que usam o
 * produto. Toda mudança de estoque feita pela entrada depois de confirmada
 * passa por aqui — é o que mantém o extrato fiel e a reversão exata.
 * Devolve a mensagem de erro, ou null.
 */
export async function ajustarEstoquePelaEntrada(sb: any, p: {
  empresaId: string; entradaId: string; produtoId: string; delta: number
  motivo: string; usuario?: string | null; nomeProduto?: string | null
}): Promise<string | null> {
  if (Math.abs(p.delta) < 0.0005) return null
  const { data: prod, error: erroLer } = await sb.from('produtos')
    .select('estoque, nome').eq('id', p.produtoId).maybeSingle()
  if (erroLer || !prod) return `${p.nomeProduto || p.produtoId}: produto não encontrado`

  const antes = Number(prod.estoque ?? 0)
  const depois = Math.round((antes + p.delta) * 1000) / 1000
  const { error } = await sb.from('produtos')
    .update({ estoque: depois, updated_at: new Date().toISOString() }).eq('id', p.produtoId)
  if (error) return `${prod.nome}: ${error.message}`

  await ajustarDepositoPrincipal(sb, p.empresaId, p.produtoId, p.delta)
  await registrarMovimentoEstoque(sb, {
    empresaId: p.empresaId, produtoId: p.produtoId, produtoNome: prod.nome ?? p.nomeProduto ?? '',
    tipo: p.delta > 0 ? 'ajuste_entrada' : 'ajuste_saida',
    quantidade: Math.abs(p.delta), estoqueAnterior: antes, estoqueNovo: depois,
    motivo: p.motivo, referenciaTipo: 'entrada', referenciaId: p.entradaId, usuario: p.usuario ?? null,
  })
  await recalcularKitsQueUsam(sb, p.produtoId)
  return null
}

export async function reverterEstoqueDaEntrada(sb: any, params: {
  empresaId: string
  entradaId: string
  /** Ex.: "Exclusão da entrada ENT-000081". Vai para o extrato. */
  motivo: string
}): Promise<{ revertidos: number; erros: string[] }> {
  const { empresaId, entradaId, motivo } = params
  const erros: string[] = []

  const { data: movs, error } = await sb.from('estoque_movimentacoes')
    .select('produto_id, produto_nome, estoque_anterior, estoque_novo')
    .eq('empresa_id', empresaId).eq('referencia_tipo', 'entrada').eq('referencia_id', entradaId)
  if (error) throw new Error(`Não foi possível ler o extrato da entrada: ${error.message}`)

  let efeito = efeitoLiquidoPorProduto((movs ?? []) as MovimentoDaEntrada[])
  const nomes = new Map<string, string>(((movs ?? []) as MovimentoDaEntrada[]).map(m => [m.produto_id, m.produto_nome ?? '']))

  // Entrada antiga, de antes do extrato existir: sem movimento nenhum, o que
  // dá para saber é a quantidade de cada item.
  if ((movs ?? []).length === 0) {
    const { data: itens } = await sb.from('entrada_itens')
      .select('produto_id, quantidade, nome_produto').eq('entrada_id', entradaId)
    efeito = new Map()
    for (const i of (itens ?? []) as any[]) {
      if (!i.produto_id) continue
      efeito.set(i.produto_id, (efeito.get(i.produto_id) ?? 0) + Number(i.quantidade ?? 0))
      nomes.set(i.produto_id, i.nome_produto ?? '')
    }
  }

  const { data: auth } = await sb.auth.getUser()
  const usuario = auth?.user?.email ?? null
  let revertidos = 0

  for (const [produtoId, liquido] of efeito) {
    if (Math.abs(liquido) < 0.0005) continue
    const erro = await ajustarEstoquePelaEntrada(sb, {
      empresaId, entradaId, produtoId, delta: -liquido, motivo, usuario, nomeProduto: nomes.get(produtoId),
    })
    if (erro) erros.push(erro)
    else revertidos++
  }

  return { revertidos, erros }
}
