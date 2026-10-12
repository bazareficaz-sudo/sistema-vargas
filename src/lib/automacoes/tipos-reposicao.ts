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
