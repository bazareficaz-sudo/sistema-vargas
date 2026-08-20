import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'

// Avisa por WhatsApp quem pediu para ser avisado quando compram em nome
// dele (clientes.alerta_pedido_whatsapp). Caso real: escritório com vários
// funcionários autorizados, e o dono querendo saber na hora o que foi
// comprado.
//
// Roda pela rotina de 5 em 5 minutos (/api/cron/automacoes) em vez de
// disparar na tela do PDV. A razão é a mesma que já apareceu duas vezes
// neste sistema (gatilho de carteira, redirecionamento de cliente
// unificado): venda entra por várias portas — PDV web, PDV externo que
// grava direto no banco, orçamento faturado — e regra que mora numa tela
// não alcança quem entra pelas outras. Aqui a leitura é da tabela de
// vendas, então alcança todas.
//
// Idempotência sem tabela nova: antes de enviar, confere se já existe uma
// mensagem com referencia_tipo='venda_alerta' apontando para aquela venda.
// Se a rotina rodar duas vezes, ou se uma rodada falhar no meio, ninguém
// recebe o mesmo aviso repetido.

const TIPO_MENSAGEM = 'alerta_pedido'
const REFERENCIA_TIPO = 'venda_alerta'

// Janela de segurança: vendas mais antigas que isso não são avisadas mesmo
// que nunca tenham sido. Evita que ligar o aviso num cliente antigo dispare
// uma enxurrada de mensagens sobre compras de meses atrás.
const JANELA_HORAS = 24

function fmtMoeda(v: number) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function telefoneDoAviso(cli: any): string | null {
  return cli.alerta_pedido_telefone || cli.telefone_whatsapp || cli.whatsapp || cli.telefone || null
}

export async function enviarAlertasDePedido(sb: any): Promise<{ avisados: number; semTelefone: number; falhas: number }> {
  const { data: clientes } = await sb.from('clientes')
    .select('id, nome, empresa_id, telefone, whatsapp, telefone_whatsapp, alerta_pedido_telefone, opt_out_whatsapp')
    .eq('alerta_pedido_whatsapp', true).eq('ativo', true)

  if (!clientes || clientes.length === 0) return { avisados: 0, semTelefone: 0, falhas: 0 }

  const desde = new Date(Date.now() - JANELA_HORAS * 3600_000).toISOString()
  const { data: vendas } = await sb.from('vendas')
    .select('id, numero, total, created_at, cliente_id, operador_nome, vendedor_nome')
    .in('cliente_id', clientes.map((c: any) => c.id))
    .eq('status', 'concluida')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })

  if (!vendas || vendas.length === 0) return { avisados: 0, semTelefone: 0, falhas: 0 }

  // Quais dessas vendas já foram avisadas — uma consulta só para o lote.
  const { data: jaAvisadas } = await sb.from('whatsapp_mensagens')
    .select('referencia_id').eq('referencia_tipo', REFERENCIA_TIPO)
    .in('referencia_id', vendas.map((v: any) => v.id))
  const avisadas = new Set<string>((jaAvisadas ?? []).map((m: any) => m.referencia_id as string))

  const pendentes = vendas.filter((v: any) => !avisadas.has(v.id))
  if (pendentes.length === 0) return { avisados: 0, semTelefone: 0, falhas: 0 }

  // Itens de todas as vendas pendentes, de uma vez.
  const { data: itens } = await sb.from('venda_itens')
    .select('venda_id, produto_nome, quantidade, preco_unitario, tipo')
    .in('venda_id', pendentes.map((v: any) => v.id))
  const itensPorVenda = new Map<string, any[]>()
  for (const i of itens ?? []) {
    const lista = itensPorVenda.get(i.venda_id) ?? []
    lista.push(i)
    itensPorVenda.set(i.venda_id, lista)
  }

  // Contatos que pediram para receber o aviso — o dono quer no celular
  // dele, mas o gerente da obra também pode querer. Cada um recebe uma
  // cópia da mesma mensagem.
  const { data: contatos } = await sb.from('cliente_contatos')
    .select('cliente_id, nome, telefone')
    .in('cliente_id', clientes.map((c: any) => c.id))
    .eq('recebe_avisos', true).eq('ativo', true)
  const contatosPorCliente = new Map<string, any[]>()
  for (const c of contatos ?? []) {
    if (!c.telefone) continue
    const lista = contatosPorCliente.get(c.cliente_id) ?? []
    lista.push(c)
    contatosPorCliente.set(c.cliente_id, lista)
  }

  const clientePorId = new Map<string, any>(clientes.map((c: any) => [c.id, c]))
  let avisados = 0, semTelefone = 0, falhas = 0

  for (const venda of pendentes) {
    const cli = clientePorId.get(venda.cliente_id)
    if (!cli || cli.opt_out_whatsapp) continue

    const telefone = telefoneDoAviso(cli)
    const extras = contatosPorCliente.get(cli.id) ?? []
    if (!telefone && extras.length === 0) { semTelefone++; continue }

    // Só o que foi comprado — devolução dentro da mesma venda não entra na
    // lista, senão a mensagem diria que compraram algo que voltou.
    const linhas = (itensPorVenda.get(venda.id) ?? [])
      .filter((i: any) => i.tipo !== 'devolucao')
      .map((i: any) => `• ${i.produto_nome} — ${Number(i.quantidade)}x ${fmtMoeda(i.preco_unitario)}`)

    const quem = venda.vendedor_nome || venda.operador_nome
    const mensagem =
      `🧾 Compra registrada em nome de *${cli.nome}*\n\n` +
      `Pedido #${venda.numero ?? String(venda.id).slice(-6).toUpperCase()}\n` +
      `${new Date(venda.created_at).toLocaleString('pt-BR')}\n` +
      (quem ? `Atendido por: ${quem}\n` : '') +
      (linhas.length > 0 ? `\n${linhas.slice(0, 30).join('\n')}` : '') +
      (linhas.length > 30 ? `\n… e mais ${linhas.length - 30} item(ns)` : '') +
      `\n\n*Total: ${fmtMoeda(venda.total)}*`

    // Número principal + contatos marcados, sem repetir o mesmo número.
    const destinos = Array.from(new Set([telefone, ...extras.map((c: any) => c.telefone)]
      .filter((t): t is string => !!t)))

    let algumOk = false
    for (const destino of destinos) {
      const r = await enviarWhatsappAutomacao(sb, venda.empresa_id ?? cli.empresa_id, destino, mensagem, {
        tipo: TIPO_MENSAGEM,
        cliente_id: cli.id,
        cliente_nome: cli.nome,
        referencia_tipo: REFERENCIA_TIPO,
        referencia_id: venda.id,
      })
      if (r.ok) algumOk = true
    }
    if (algumOk) avisados++
    else falhas++
  }

  return { avisados, semTelefone, falhas }
}
