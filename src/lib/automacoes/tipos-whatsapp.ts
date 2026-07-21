import { enviarWhatsappAutomacao } from './whatsapp-send'
import { fmtMoeda, type ResultadoExecucao } from './tipos'

export async function executarRelatorioDiario(sb: any, a: any): Promise<ResultadoExecucao> {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const fimHoje = new Date(); fimHoje.setHours(23, 59, 59, 999)
  const linhas: string[] = []

  async function vendasDia() {
    const { data } = await sb.from('vendas').select('total').eq('empresa_id', a.empresa_id).eq('status', 'concluida')
      .gte('created_at', hoje.toISOString()).lte('created_at', fimHoje.toISOString())
    const total = (data ?? []).reduce((s: number, v: any) => s + Number(v.total ?? 0), 0)
    linhas.push(`💰 Vendas do dia: ${data?.length ?? 0} venda(s) · ${fmtMoeda(total)}`)
  }
  async function estoqueBaixo() {
    const { data } = await sb.from('produtos').select('id, estoque, estoque_minimo').eq('empresa_id', a.empresa_id).eq('ativo', true)
    const baixos = (data ?? []).filter((p: any) => Number(p.estoque_minimo ?? 0) > 0 && Number(p.estoque ?? 0) < Number(p.estoque_minimo))
    linhas.push(`📉 Estoque baixo: ${baixos.length} produto(s)`)
  }
  async function contasReceber() {
    const { data } = await sb.from('contas_receber').select('valor_aberto').eq('empresa_id', a.empresa_id).in('status', ['aberto', 'vencido'])
    const total = (data ?? []).reduce((s: number, c: any) => s + Number(c.valor_aberto ?? 0), 0)
    linhas.push(`📥 A receber em aberto: ${data?.length ?? 0} conta(s) · ${fmtMoeda(total)}`)
  }
  async function contasPagar() {
    const { data } = await sb.from('contas_pagar').select('valor').eq('empresa_id', a.empresa_id).in('status', ['pendente', 'vencido'])
    const total = (data ?? []).reduce((s: number, c: any) => s + Number(c.valor ?? 0), 0)
    linhas.push(`📤 A pagar em aberto: ${data?.length ?? 0} conta(s) · ${fmtMoeda(total)}`)
  }

  if (a.tipo_relatorio === 'vendas_dia') await vendasDia()
  else if (a.tipo_relatorio === 'estoque_baixo') await estoqueBaixo()
  else if (a.tipo_relatorio === 'contas_receber') await contasReceber()
  else if (a.tipo_relatorio === 'contas_pagar') await contasPagar()
  else { await vendasDia(); await estoqueBaixo(); await contasReceber(); await contasPagar() }

  const mensagem = `📊 Relatório automático — ${new Date().toLocaleDateString('pt-BR')}\n\n${linhas.join('\n')}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}

export async function executarPedidoCliente(sb: any, a: any): Promise<ResultadoExecucao> {
  const desde = a.cursor_processado ?? a.created_at
  const { data: vendas } = await sb.from('vendas').select('id, numero, total, created_at')
    .eq('empresa_id', a.empresa_id).eq('cliente_id', a.cliente_id).eq('status', 'concluida')
    .gt('created_at', desde).order('created_at', { ascending: true })

  if (!vendas || vendas.length === 0) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const { data: cliente } = await sb.from('clientes').select('telefone').eq('id', a.cliente_id).single()
  if (!cliente?.telefone) return { status: 'erro', erro: 'Cliente sem telefone cadastrado', avancarCursorPara: new Date().toISOString() }

  let falhas = 0
  for (const v of vendas) {
    const mensagem = `🧾 Recebemos seu pedido #${v.numero}!\n💰 Total: ${fmtMoeda(v.total)}\n📅 ${new Date(v.created_at).toLocaleString('pt-BR')}\n\nObrigado pela preferência! 🙏`
    const r = await enviarWhatsappAutomacao(sb, a.empresa_id, cliente.telefone, mensagem, {
      tipo: a.tipo, cliente_id: a.cliente_id, cliente_nome: a.cliente_nome, referencia_tipo: 'venda', referencia_id: v.id,
    })
    if (!r.ok) falhas++
  }
  return { status: falhas === vendas.length ? 'erro' : 'ok', erro: falhas > 0 ? `${falhas} envio(s) falharam` : undefined, avancarCursorPara: new Date().toISOString() }
}

export async function executarAlertaProduto(sb: any, a: any): Promise<ResultadoExecucao> {
  const produtoIds = (a.produtos ?? []).map((p: any) => p.produto_id)
  if (produtoIds.length === 0) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const desde = a.cursor_processado ?? a.created_at
  const { data: vendasNovas } = await sb.from('vendas').select('id, numero, created_at')
    .eq('empresa_id', a.empresa_id).eq('status', 'concluida').gt('created_at', desde)
  if (!vendasNovas || vendasNovas.length === 0) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const vendaIds = vendasNovas.map((v: any) => v.id)
  const { data: itens } = await sb.from('venda_itens').select('venda_id, produto_id, produto_nome, quantidade')
    .in('venda_id', vendaIds).in('produto_id', produtoIds).eq('tipo', 'venda')

  if (!itens || itens.length === 0) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const linhas = itens.map((i: any) => `• ${i.produto_nome} — ${i.quantidade}x`)
  const mensagem = `📦 Alerta de venda\n\n${linhas.join('\n')}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return { status: r.ok ? 'ok' : 'erro', erro: r.erro, avancarCursorPara: new Date().toISOString() }
}

export async function executarAlertaPedidoMarketplace(sb: any, a: any): Promise<ResultadoExecucao> {
  if (!a.marketplace_canal_id) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const desde = a.cursor_processado ?? a.created_at
  const { data: canal } = await sb.from('marketplace_canais').select('nome').eq('id', a.marketplace_canal_id).maybeSingle()
  const nomeCanal = canal?.nome ?? 'Canal'

  const { data: pedidos } = await sb.from('marketplace_pedidos')
    .select('id, numero_pedido, id_externo, valor_total, prazo_postagem, created_at, marketplace_pedido_itens(produto_id, nome_produto, quantidade)')
    .eq('canal_id', a.marketplace_canal_id).gt('created_at', desde)
  if (!pedidos || pedidos.length === 0) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  // Estoque atual de cada produto vendido, numa única consulta (evita 1
  // consulta por item quando um pedido tem vários produtos).
  const produtoIds = Array.from(new Set(
    pedidos.flatMap((p: any) => (p.marketplace_pedido_itens ?? []).map((i: any) => i.produto_id).filter(Boolean))
  ))
  let estoquePorProduto: Record<string, number> = {}
  if (produtoIds.length > 0) {
    const { data: produtosVendidos } = await sb.from('produtos').select('id, estoque').in('id', produtoIds)
    estoquePorProduto = Object.fromEntries((produtosVendidos ?? []).map((pr: any) => [pr.id, pr.estoque]))
  }

  const linhas = pedidos.map((p: any) => {
    const itens = p.marketplace_pedido_itens ?? []
    const itensTxt = itens.map((i: any) => {
      const temEstoque = i.produto_id && i.produto_id in estoquePorProduto
      const estoqueTxt = temEstoque ? `estoque: ${estoquePorProduto[i.produto_id]}` : 'sem produto vinculado'
      return `   - ${i.nome_produto} — ${i.quantidade}x · ${estoqueTxt}`
    }).join('\n')
    return `• Pedido ${p.numero_pedido ?? p.id_externo} — ${fmtMoeda(Number(p.valor_total ?? 0))}${p.prazo_postagem ? ` · prazo ${new Date(p.prazo_postagem).toLocaleDateString('pt-BR')}` : ''}\n${itensTxt}`
  })
  const mensagem = `🏪 ${nomeCanal} — ${pedidos.length} pedido(s) novo(s)\n\n${linhas.join('\n\n')}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return { status: r.ok ? 'ok' : 'erro', erro: r.erro, avancarCursorPara: new Date().toISOString() }
}

export async function executarEstoqueBaixo(sb: any, a: any): Promise<ResultadoExecucao> {
  const { data } = await sb.from('produtos').select('nome, estoque, estoque_minimo').eq('empresa_id', a.empresa_id).eq('ativo', true)
  const limite = Number(a.limite_estoque ?? 0)
  const baixos = (data ?? []).filter((p: any) => {
    if (limite > 0) return Number(p.estoque ?? 0) < limite
    return Number(p.estoque_minimo ?? 0) > 0 && Number(p.estoque ?? 0) < Number(p.estoque_minimo)
  })
  if (baixos.length === 0) return { status: 'sem_acao' }

  const linhas = baixos.slice(0, 30).map((p: any) => `• ${p.nome} — estoque ${p.estoque} (mín. ${p.estoque_minimo ?? limite})`)
  const mensagem = `📉 Estoque baixo — ${baixos.length} produto(s)\n\n${linhas.join('\n')}${baixos.length > 30 ? `\n... e mais ${baixos.length - 30}` : ''}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}

export async function executarContaReceber(sb: any, a: any): Promise<ResultadoExecucao> {
  const limite = new Date(); limite.setDate(limite.getDate() + Number(a.dias_alerta ?? 0))
  const { data } = await sb.from('contas_receber').select('cliente_nome, valor_aberto, data_vencimento')
    .eq('empresa_id', a.empresa_id).in('status', ['aberto', 'vencido']).lte('data_vencimento', limite.toISOString().slice(0, 10))
  if (!data || data.length === 0) return { status: 'sem_acao' }

  const total = data.reduce((s: number, c: any) => s + Number(c.valor_aberto ?? 0), 0)
  const linhas = data.slice(0, 30).map((c: any) => `• ${c.cliente_nome} — ${fmtMoeda(Number(c.valor_aberto ?? 0))} · vence ${new Date(c.data_vencimento).toLocaleDateString('pt-BR')}`)
  const mensagem = `💰 Contas a receber vencendo em até ${a.dias_alerta} dia(s) — ${data.length} conta(s), ${fmtMoeda(total)}\n\n${linhas.join('\n')}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}

export async function executarContaPagar(sb: any, a: any): Promise<ResultadoExecucao> {
  const limite = new Date(); limite.setDate(limite.getDate() + Number(a.dias_alerta ?? 0))
  const { data } = await sb.from('contas_pagar').select('descricao, valor, vencimento')
    .eq('empresa_id', a.empresa_id).in('status', ['pendente', 'vencido']).lte('vencimento', limite.toISOString().slice(0, 10))
  if (!data || data.length === 0) return { status: 'sem_acao' }

  const total = data.reduce((s: number, c: any) => s + Number(c.valor ?? 0), 0)
  const linhas = data.slice(0, 30).map((c: any) => `• ${c.descricao} — ${fmtMoeda(Number(c.valor ?? 0))} · vence ${new Date(c.vencimento).toLocaleDateString('pt-BR')}`)
  const mensagem = `💳 Contas a pagar vencendo em até ${a.dias_alerta} dia(s) — ${data.length} conta(s), ${fmtMoeda(total)}\n\n${linhas.join('\n')}`
  const r = await enviarWhatsappAutomacao(sb, a.empresa_id, a.numero_destino, mensagem, { tipo: a.tipo })
  return r.ok ? { status: 'ok' } : { status: 'erro', erro: r.erro }
}
