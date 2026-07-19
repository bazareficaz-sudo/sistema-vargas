import { enviarWhatsappAutomacao } from './whatsapp-send'
import { fmtMoeda, type ResultadoExecucao } from './tipos'

export async function executarMargemBaixa(sb: any, a: any): Promise<ResultadoExecucao> {
  const produtoIds = (a.produtos ?? []).map((p: any) => p.produto_id)
  let query = sb.from('produtos').select('nome, preco_custo, preco_venda').eq('empresa_id', a.empresa_id).eq('ativo', true)
    .gt('preco_custo', 0).gt('preco_venda', 0)
  if (produtoIds.length > 0) query = query.in('id', produtoIds)
  const { data } = await query

  const limite = Number(a.limite_estoque ?? 0)
  const abaixo = (data ?? [])
    .map((p: any) => ({ nome: p.nome, margem: (Number(p.preco_venda) - Number(p.preco_custo)) / Number(p.preco_custo) * 100 }))
    .filter((p: any) => p.margem < limite)
  if (abaixo.length === 0) return { status: 'sem_acao' }

  const linhas = abaixo.slice(0, 30).map((p: any) => `• ${p.nome} — margem ${p.margem.toFixed(1)}%`)
  const mensagem = `📉 Margem abaixo de ${limite}% — ${abaixo.length} produto(s)\n\n${linhas.join('\n')}${abaixo.length > 30 ? `\n... e mais ${abaixo.length - 30}` : ''}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}

export async function executarProdutoParado(sb: any, a: any): Promise<ResultadoExecucao> {
  const produtoIds = (a.produtos ?? []).map((p: any) => p.produto_id)
  let query = sb.from('produtos').select('id, nome, estoque').eq('empresa_id', a.empresa_id).eq('ativo', true).gt('estoque', 0)
  if (produtoIds.length > 0) query = query.in('id', produtoIds)
  const { data: produtos } = await query
  if (!produtos || produtos.length === 0) return { status: 'sem_acao' }

  const dias = Number(a.dias_alerta ?? 30)
  const desde = new Date(); desde.setDate(desde.getDate() - dias)

  const { data: vendasRecentes } = await sb.from('vendas').select('id').eq('empresa_id', a.empresa_id).eq('status', 'concluida').gte('created_at', desde.toISOString())
  const vendaIds = (vendasRecentes ?? []).map((v: any) => v.id)
  const comVendaRecente = new Set<string>()
  if (vendaIds.length > 0) {
    const { data: itens } = await sb.from('venda_itens').select('produto_id').in('venda_id', vendaIds)
    for (const i of itens ?? []) comVendaRecente.add(i.produto_id)
  }

  const parados = produtos.filter((p: any) => !comVendaRecente.has(p.id))
  if (parados.length === 0) return { status: 'sem_acao' }

  const linhas = parados.slice(0, 30).map((p: any) => `• ${p.nome} — estoque ${p.estoque}`)
  const mensagem = `🐌 Sem venda há ${dias}+ dias — ${parados.length} produto(s)\n\n${linhas.join('\n')}${parados.length > 30 ? `\n... e mais ${parados.length - 30}` : ''}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}

export async function executarInadimplencia(sb: any, a: any): Promise<ResultadoExecucao> {
  const limite = new Date(); limite.setDate(limite.getDate() - Number(a.dias_alerta ?? 0))
  const { data } = await sb.from('contas_receber').select('cliente_nome, valor_aberto, data_vencimento')
    .eq('empresa_id', a.empresa_id).eq('status', 'vencido').lte('data_vencimento', limite.toISOString().slice(0, 10))
  if (!data || data.length === 0) return { status: 'sem_acao' }

  const total = data.reduce((s: number, c: any) => s + Number(c.valor_aberto ?? 0), 0)
  const linhas = data.slice(0, 30).map((c: any) => {
    const atrasoDias = Math.floor((Date.now() - new Date(c.data_vencimento).getTime()) / 86400000)
    return `• ${c.cliente_nome} — ${fmtMoeda(Number(c.valor_aberto ?? 0))} · ${atrasoDias}d de atraso`
  })
  const mensagem = `⚠️ Inadimplência acima de ${a.dias_alerta} dia(s) — ${data.length} cliente(s), ${fmtMoeda(total)}\n\n${linhas.join('\n')}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}

export async function executarMetaVendas(sb: any, a: any): Promise<ResultadoExecucao> {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const fimHoje = new Date(); fimHoje.setHours(23, 59, 59, 999)
  const { data } = await sb.from('vendas').select('total').eq('empresa_id', a.empresa_id).eq('status', 'concluida')
    .gte('created_at', hoje.toISOString()).lte('created_at', fimHoje.toISOString())
  const totalHoje = (data ?? []).reduce((s: number, v: any) => s + Number(v.total ?? 0), 0)
  const meta = Number(a.limite_estoque ?? 0)
  if (totalHoje >= meta) return { status: 'sem_acao' }

  const mensagem = `🎯 Meta de vendas não atingida\n\nVendido até agora: ${fmtMoeda(totalHoje)}\nMeta do dia: ${fmtMoeda(meta)}\nFaltam: ${fmtMoeda(meta - totalHoje)}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}
