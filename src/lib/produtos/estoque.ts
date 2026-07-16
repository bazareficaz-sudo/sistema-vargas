import { recalcularKitsQueUsam } from './kit'

// Baixa de estoque de um item de pedido de marketplace. Evita dois riscos
// reais quando cron automático e botão manual podem rodar quase juntos:
// (1) baixar duas vezes o mesmo item, (2) deixar estoque negativo. Sem
// worker/fila persistente nesta versão, a atomicidade vem de duas técnicas
// simples via supabase-js (sem stored procedure, fora do padrão do projeto):
//   - "reivindicar" o item com um UPDATE condicional em baixou_estoque
//     (WHERE baixou_estoque = false) — só um chamador consegue.
//   - decrementar o estoque com compare-and-swap (lê o valor, escreve de
//     volta com WHERE estoque = valor_lido) — se outro processo alterou o
//     valor no meio do caminho, a escrita afeta 0 linhas e tenta de novo.

export type ResultadoBaixa = { ok: true; jaProcessado?: boolean } | { ok: false; motivo: string }

async function decrementarEstoqueAtomico(sb: any, produtoId: string, quantidade: number): Promise<{ ok: true } | { ok: false; motivo: string }> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { data: produto } = await sb.from('produtos').select('estoque').eq('id', produtoId).single()
    if (!produto) return { ok: false, motivo: 'Produto não encontrado' }
    if (produto.estoque < quantidade) return { ok: false, motivo: `Estoque insuficiente (disponível: ${produto.estoque}, necessário: ${quantidade})` }

    const { data: atualizado } = await sb.from('produtos')
      .update({ estoque: produto.estoque - quantidade })
      .eq('id', produtoId).eq('estoque', produto.estoque)
      .select('id').maybeSingle()
    if (atualizado) return { ok: true }
    // conflito de concorrência — outro processo alterou o estoque entre a leitura e a escrita; tenta de novo
  }
  return { ok: false, motivo: 'Conflito de concorrência ao atualizar estoque — tente novamente' }
}

async function incrementarEstoque(sb: any, produtoId: string, quantidade: number): Promise<void> {
  const { data: produto } = await sb.from('produtos').select('estoque').eq('id', produtoId).single()
  if (!produto) return
  await sb.from('produtos').update({ estoque: produto.estoque + quantidade }).eq('id', produtoId)
}

async function baixarComponentesKit(sb: any, kitProdutoId: string, quantidadePedido: number): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { data: itens } = await sb.from('kit_itens').select('produto_id, quantidade').eq('kit_id', kitProdutoId)
  if (!itens || itens.length === 0) return { ok: false, motivo: 'Kit sem componentes cadastrados' }

  const decrementados: { produtoId: string; quantidade: number }[] = []
  for (const item of itens) {
    const qtdNecessaria = item.quantidade * quantidadePedido
    const resultado = await decrementarEstoqueAtomico(sb, item.produto_id, qtdNecessaria)
    if (!resultado.ok) {
      for (const d of decrementados) await incrementarEstoque(sb, d.produtoId, d.quantidade)
      return { ok: false, motivo: `Componente sem estoque suficiente: ${resultado.motivo}` }
    }
    decrementados.push({ produtoId: item.produto_id, quantidade: qtdNecessaria })
  }

  for (const item of itens) await recalcularKitsQueUsam(sb, item.produto_id)
  return { ok: true }
}

export async function baixarEstoquePedidoItem(sb: any, pedidoItemId: string): Promise<ResultadoBaixa> {
  const { data: itemAtual } = await sb.from('marketplace_pedido_itens')
    .select('id, pedido_id, produto_id, quantidade, baixou_estoque')
    .eq('id', pedidoItemId).single()
  if (!itemAtual) return { ok: false, motivo: 'Item do pedido não encontrado' }
  if (itemAtual.baixou_estoque) return { ok: true, jaProcessado: true }
  if (!itemAtual.produto_id) return { ok: false, motivo: 'Item sem produto vinculado' }

  // Reivindica atomicamente — se outro processo já setou baixou_estoque=true
  // entre a leitura acima e agora, este UPDATE não afeta nenhuma linha.
  const { data: claim } = await sb.from('marketplace_pedido_itens')
    .update({ baixou_estoque: true })
    .eq('id', pedidoItemId).eq('baixou_estoque', false)
    .select('id').maybeSingle()
  if (!claim) return { ok: true, jaProcessado: true }

  const { data: produto } = await sb.from('produtos').select('id, tipo').eq('id', itemAtual.produto_id).single()
  if (!produto) {
    await sb.from('marketplace_pedido_itens').update({ baixou_estoque: false }).eq('id', pedidoItemId)
    return { ok: false, motivo: 'Produto vinculado não encontrado' }
  }

  const resultado = produto.tipo === 'kit'
    ? await baixarComponentesKit(sb, produto.id, itemAtual.quantidade)
    : await decrementarEstoqueAtomico(sb, produto.id, itemAtual.quantidade)

  if (!resultado.ok) {
    await sb.from('marketplace_pedido_itens').update({ baixou_estoque: false }).eq('id', pedidoItemId)
    await sb.from('marketplace_pedidos')
      .update({ etapa_interna: 'com_pendencia', pendencia_motivo: resultado.motivo })
      .eq('id', itemAtual.pedido_id)
    return { ok: false, motivo: resultado.motivo }
  }

  return { ok: true }
}
