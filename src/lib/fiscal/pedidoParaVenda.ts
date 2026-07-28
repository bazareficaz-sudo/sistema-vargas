// Cria (sob demanda, só quando o usuário pede pra emitir) uma linha real em
// vendas/venda_itens a partir de um pedido de marketplace — daí reaproveita
// 100% de emitirNfceParaVenda() já usada por PDV/Vendas/Automações, sem
// duplicar nenhuma lógica fiscal. Idempotente: se o pedido já tem venda_id,
// devolve ela direto (reemitir/consultar status usa sempre a mesma linha).
export type ResultadoGarantirVenda =
  | { ok: true; vendaId: string }
  | { ok: false; erro: string }

export async function garantirVendaDoPedido(sb: any, pedidoId: string, empresaId: string): Promise<ResultadoGarantirVenda> {
  const { data: pedido } = await sb.from('marketplace_pedidos')
    .select('id, venda_id, numero_pedido, id_externo, cliente_nome, valor_produtos, valor_desconto, valor_total, data_pedido, canal_id')
    .eq('id', pedidoId).eq('empresa_id', empresaId).single()
  if (!pedido) return { ok: false, erro: 'Pedido não encontrado' }
  if (pedido.venda_id) return { ok: true, vendaId: pedido.venda_id }

  const { data: itens } = await sb.from('marketplace_pedido_itens')
    .select('produto_id, nome_produto, sku, quantidade, preco_unitario, subtotal')
    .eq('pedido_id', pedidoId)
  if (!itens || itens.length === 0) return { ok: false, erro: 'Pedido sem itens' }

  const semProduto = itens.filter((i: any) => !i.produto_id)
  if (semProduto.length > 0) {
    const nomes = semProduto.map((i: any) => i.nome_produto).join(', ')
    return { ok: false, erro: `Item(s) sem produto vinculado — mapeie antes de emitir: ${nomes}` }
  }

  const { data: canal } = await sb.from('marketplace_canais').select('plataforma').eq('id', pedido.canal_id).maybeSingle()

  const produtoIds = [...new Set(itens.map((i: any) => i.produto_id))]
  const { data: produtos } = await sb.from('produtos').select('id, preco_custo').in('id', produtoIds)
  const custoPorId = new Map((produtos ?? []).map((p: any) => [p.id, p.preco_custo]))

  const numeroRef = pedido.numero_pedido || pedido.id_externo
  const { data: venda, error: errVenda } = await sb.from('vendas').insert({
    empresa_id: empresaId,
    cliente_id: null,
    operador_nome: 'Sistema (pedido marketplace)',
    status: 'concluida',
    subtotal: pedido.valor_produtos ?? pedido.valor_total,
    desconto: pedido.valor_desconto ?? 0,
    total: pedido.valor_total,
    forma_pagamento: 'marketplace',
    valor_pago: pedido.valor_total,
    troco: 0,
    observacao: `Pedido marketplace ${numeroRef}${pedido.cliente_nome ? ` — ${pedido.cliente_nome}` : ''}`,
    tipo_operacao: 'venda',
    tem_devolucao: false,
    total_devolucoes: 0,
    credito_gerado: 0,
    pagamentos: [{ forma: 'marketplace', valor: pedido.valor_total }],
    canal: canal?.plataforma ?? 'marketplace',
    created_at: pedido.data_pedido,
  }).select().single()
  if (errVenda) return { ok: false, erro: errVenda.message }

  const { error: errItens } = await sb.from('venda_itens').insert(itens.map((i: any) => ({
    venda_id: venda.id,
    produto_id: i.produto_id, produto_nome: i.nome_produto, produto_sku: i.sku,
    quantidade: i.quantidade, preco_unitario: i.preco_unitario, desconto: 0, total: i.subtotal,
    custo_unitario: custoPorId.get(i.produto_id) ?? 0,
    tipo: 'venda',
  })))
  if (errItens) return { ok: false, erro: errItens.message }

  await sb.from('marketplace_pedidos').update({ venda_id: venda.id }).eq('id', pedidoId)

  return { ok: true, vendaId: venda.id }
}
