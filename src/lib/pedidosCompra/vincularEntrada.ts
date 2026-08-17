// Fecha o laço entre um pedido de compra e a entrada que o atendeu.
//
// Chamado depois que uma entrada (manual, por ora) é confirmada com
// `pedido_compra_id` preenchido. Faz duas coisas:
//
//  1. Soma o que já entrou deste pedido, produto a produto, e decide se o
//     pedido virou "recebido" (tudo chegou) ou "parcialmente_recebido"
//     (só parte). Sem isso o pedido ficava "enviado" para sempre, mesmo
//     depois de a mercadoria ter chegado — e o Auxiliar de Compras
//     continuaria contando aquela quantidade como "já a caminho".
//
//  2. É esse vínculo, ao longo do tempo, que alimenta o prazo real de
//     entrega em `fornecedor_produto` (calculado por
//     `recalcularFornecedorProduto`, comparando `pedidos_compra.data_pedido`
//     com a data da entrada). Uma entrada não vinculada não ensina nada
//     sobre o prazo do fornecedor — fica só como comprovante de estoque.

export async function atualizarStatusPedidoAposEntrada(
  sb: any, empresaId: string, pedidoCompraId: string,
): Promise<void> {
  const { data: pedido } = await sb.from('pedidos_compra')
    .select('id, status').eq('id', pedidoCompraId).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido || pedido.status === 'cancelado' || pedido.status === 'recebido') return

  const { data: itensPedido } = await sb.from('pedidos_compra_itens')
    .select('produto_id, quantidade').eq('pedido_id', pedidoCompraId)
  if (!itensPedido?.length) return

  // Todas as entradas confirmadas já vinculadas a este pedido — não só a
  // que acabou de ser salva, porque um pedido pode chegar em mais de uma
  // remessa.
  const { data: entradas } = await sb.from('entradas')
    .select('id').eq('empresa_id', empresaId).eq('pedido_compra_id', pedidoCompraId).eq('status', 'confirmada')
  const entradaIds = (entradas ?? []).map((e: any) => e.id)
  if (entradaIds.length === 0) return

  const { data: itensRecebidos } = await sb.from('entrada_itens')
    .select('produto_id, quantidade').in('entrada_id', entradaIds)

  const recebidoPorProduto = new Map<string, number>()
  for (const it of itensRecebidos ?? []) {
    if (!it.produto_id) continue
    recebidoPorProduto.set(it.produto_id, (recebidoPorProduto.get(it.produto_id) ?? 0) + Number(it.quantidade ?? 0))
  }

  const completo = itensPedido.every((i: any) =>
    (recebidoPorProduto.get(i.produto_id) ?? 0) >= Number(i.quantidade ?? 0) - 0.001)

  const novoStatus = completo ? 'recebido' : 'parcialmente_recebido'
  if (novoStatus !== pedido.status) {
    await sb.from('pedidos_compra')
      .update({ status: novoStatus, updated_at: new Date().toISOString() })
      .eq('id', pedidoCompraId).eq('empresa_id', empresaId)
  }
}
