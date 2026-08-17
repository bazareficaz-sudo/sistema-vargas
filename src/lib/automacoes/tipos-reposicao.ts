import { enviarWhatsappAutomacao } from './whatsapp-send'
import { fmtMoeda, type ResultadoExecucao } from './tipos'

async function produtosAbaixoMinimo(sb: any, a: any) {
  const produtoIds = (a.produtos ?? []).map((p: any) => p.produto_id)
  let query = sb.from('produtos').select('id, nome, sku, estoque, estoque_minimo, preco_custo').eq('empresa_id', a.empresa_id).eq('ativo', true)
  if (produtoIds.length > 0) query = query.in('id', produtoIds)
  const { data } = await query

  const limite = Number(a.limite_estoque ?? 0)
  return (data ?? []).filter((p: any) => {
    if (limite > 0) return Number(p.estoque ?? 0) < limite
    return Number(p.estoque_minimo ?? 0) > 0 && Number(p.estoque ?? 0) < Number(p.estoque_minimo)
  })
}

export async function executarReposicaoMinimo(sb: any, a: any): Promise<ResultadoExecucao> {
  const baixos = await produtosAbaixoMinimo(sb, a)
  if (baixos.length === 0) return { status: 'sem_acao' }

  const linhas = baixos.slice(0, 30).map((p: any) => `• ${p.nome} — estoque ${p.estoque} (mín. ${p.estoque_minimo})`)
  const mensagem = `🔄 Reposição necessária — ${baixos.length} produto(s) abaixo do mínimo\n\n${linhas.join('\n')}${baixos.length > 30 ? `\n... e mais ${baixos.length - 30}` : ''}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}

// Cria um pedido de compra em RASCUNHO com os produtos abaixo do mínimo —
// nunca envia nada pro fornecedor sozinho. O rascunho fica em Compras >
// Pedido ao Fornecedor esperando revisão humana (escolher fornecedor,
// ajustar quantidades, confirmar) antes de virar um pedido de verdade.
//
// Desde que o Auxiliar de Compras passou a gerar pedido pela mesma via
// (origem='auxiliar'), os dois caminhos disputam os mesmos produtos sem
// se falar. Este é o único ponto de todas as automações de reposição que
// de fato grava um `pedidos_compra` — as outras três só mandam alerta por
// WhatsApp. Por isso a correção mora só aqui: produto que já tem pedido
// em aberto (de qualquer origem) sai da lista antes de criar outro, e o
// que for criado carrega `origem='automacao'` para não se confundir com o
// que o comprador montou à mão.
export async function executarPedidoAutomatico(sb: any, a: any): Promise<ResultadoExecucao> {
  const baixos0 = await produtosAbaixoMinimo(sb, a)
  if (baixos0.length === 0) return { status: 'sem_acao' }

  const { data: itensEmAberto } = await sb.from('pedidos_compra_itens')
    .select('produto_id, pedidos_compra!inner(empresa_id, status)')
    .eq('pedidos_compra.empresa_id', a.empresa_id)
    .not('pedidos_compra.status', 'in', '("cancelado","recebido")')
  const jaPedido = new Set((itensEmAberto ?? []).map((i: any) => i.produto_id))

  const baixos = baixos0.filter((p: any) => !jaPedido.has(p.id))
  if (baixos.length === 0) return { status: 'sem_acao' }

  const itens = baixos.map((p: any) => {
    const sugestao = Math.max(1, Math.ceil(Number(p.estoque_minimo ?? 0) - Number(p.estoque ?? 0)) || 1)
    return {
      produto_id: p.id,
      quantidade: sugestao,
      custo_unitario: Number(p.preco_custo ?? 0),
      total: sugestao * Number(p.preco_custo ?? 0),
    }
  })
  const subtotal = itens.reduce((s: number, i: any) => s + i.total, 0)

  const { data: pedido, error: erroPedido } = await sb.from('pedidos_compra').insert({
    empresa_id: a.empresa_id,
    status: 'rascunho',
    origem: 'automacao',
    observacoes: `Gerado automaticamente pela automação "${a.nome}" — revise fornecedor e quantidades antes de enviar.`,
    subtotal,
    total: subtotal,
  }).select('id, numero').single()

  if (erroPedido) return { status: 'erro', erro: erroPedido.message }

  await sb.from('pedidos_compra_itens').insert(itens.map((i: any) => ({ ...i, pedido_id: pedido.id })))

  if (a.numero_destino) {
    const linhas = baixos.slice(0, 30).map((p: any) => `• ${p.nome} — sugestão ${itens.find((i: any) => i.produto_id === p.id)?.quantidade}un`)
    const mensagem = `🔄 Rascunho de pedido de compra criado (nº ${pedido.numero}) — ${baixos.length} produto(s)\n\n${linhas.join('\n')}\n\nRevise fornecedor e quantidades em Compras antes de enviar.`
    await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  }

  return { status: 'ok' }
}

export async function executarCurvaAbc(sb: any, a: any): Promise<ResultadoExecucao> {
  const produtoIds = (a.produtos ?? []).map((p: any) => p.produto_id)
  let query = sb.from('produtos').select('id, nome, estoque').eq('empresa_id', a.empresa_id).eq('ativo', true)
  if (produtoIds.length > 0) query = query.in('id', produtoIds)
  const { data: produtos } = await query
  if (!produtos || produtos.length === 0) return { status: 'sem_acao' }

  const desde30 = new Date(); desde30.setDate(desde30.getDate() - 30)
  const { data: vendas30 } = await sb.from('vendas').select('id').eq('empresa_id', a.empresa_id).eq('status', 'concluida').gte('created_at', desde30.toISOString())
  const vendaIds = (vendas30 ?? []).map((v: any) => v.id)

  const vendidoPorProduto: Record<string, number> = {}
  if (vendaIds.length > 0) {
    const { data: itens } = await sb.from('venda_itens').select('produto_id, quantidade').in('venda_id', vendaIds)
    for (const i of itens ?? []) vendidoPorProduto[i.produto_id] = (vendidoPorProduto[i.produto_id] ?? 0) + Number(i.quantidade ?? 0)
  }

  const coberturaDesejada = Number(a.dias_alerta ?? 30)
  const sugestoes = produtos.map((p: any) => {
    const vendido30 = vendidoPorProduto[p.id] ?? 0
    const mediaDia = vendido30 / 30
    const coberturaAtualDias = mediaDia > 0 ? Number(p.estoque ?? 0) / mediaDia : Infinity
    const sugestaoCompra = mediaDia > 0 ? Math.max(0, Math.ceil(mediaDia * coberturaDesejada - Number(p.estoque ?? 0))) : 0
    return { nome: p.nome, mediaDia, coberturaAtualDias, sugestaoCompra }
  }).filter((s: any) => s.sugestaoCompra > 0).sort((x: any, y: any) => y.sugestaoCompra - x.sugestaoCompra)

  if (sugestoes.length === 0) return { status: 'sem_acao' }

  const linhas = sugestoes.slice(0, 30).map((s: any) =>
    `• ${s.nome} — giro ${s.mediaDia.toFixed(1)}/dia · cobertura ${s.coberturaAtualDias === Infinity ? '—' : s.coberturaAtualDias.toFixed(0) + 'd'} · sugestão: comprar ${s.sugestaoCompra}un`
  )
  const mensagem = `📈 Sugestão de reposição por giro (cobertura alvo: ${coberturaDesejada} dias)\n\n${linhas.join('\n')}${sugestoes.length > 30 ? `\n... e mais ${sugestoes.length - 30}` : ''}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}

export async function executarProdutoParadoReposicao(sb: any, a: any): Promise<ResultadoExecucao> {
  const produtoIds = (a.produtos ?? []).map((p: any) => p.produto_id)
  let query = sb.from('produtos').select('id, nome, estoque, preco_custo').eq('empresa_id', a.empresa_id).eq('ativo', true).gt('estoque', 0)
  if (produtoIds.length > 0) query = query.in('id', produtoIds)
  const { data: produtos } = await query
  if (!produtos || produtos.length === 0) return { status: 'sem_acao' }

  const dias = Number(a.dias_alerta ?? 30)
  const desde = new Date(); desde.setDate(desde.getDate() - dias)
  const { data: vendasRecentes } = await sb.from('vendas').select('id').eq('empresa_id', a.empresa_id).eq('status', 'concluida').gte('created_at', desde.toISOString())
  const vendaIds = (vendasRecentes ?? []).map((v: any) => v.id)
  const comVenda = new Set<string>()
  if (vendaIds.length > 0) {
    const { data: itens } = await sb.from('venda_itens').select('produto_id').in('venda_id', vendaIds)
    for (const i of itens ?? []) comVenda.add(i.produto_id)
  }

  const parados = produtos.filter((p: any) => !comVenda.has(p.id))
  if (parados.length === 0) return { status: 'sem_acao' }

  const capitalParado = parados.reduce((s: number, p: any) => s + Number(p.preco_custo ?? 0) * Number(p.estoque ?? 0), 0)
  const linhas = parados.slice(0, 30).map((p: any) => `• ${p.nome} — estoque ${p.estoque}`)
  const mensagem = `📦 Estoque parado há ${dias}+ dias — ${parados.length} produto(s), ${fmtMoeda(capitalParado)} em capital parado\n\n${linhas.join('\n')}${parados.length > 30 ? `\n... e mais ${parados.length - 30}` : ''}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}
