import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'

// Avisa por WhatsApp o cliente que PAGOU — o par do aviso de compra
// (pedidoCliente.ts): lá "foi comprado R$ 20 na sua carteira", aqui
// "recebemos R$ 20, ficou R$ X em aberto".
//
// Roda pela rotina de 5 em 5 minutos, lendo `recebimentos`, pelo mesmo
// motivo do aviso de compra: a baixa entra por várias portas. Medido em
// 20/10/2026: as 150 baixas do mês vieram da Carteira do PDV externo, que
// grava direto no banco — uma opção que morasse só na tela do site não
// alcançaria nenhuma delas.
//
// Quem recebe aviso:
//   - a baixa marcou "avisar" (recebimentos.avisar_cliente = true), ou
//   - a baixa não disse nada (null) e o cadastro do cliente pede
//     (clientes.alerta_pagamento_whatsapp).
// A baixa que desmarcou (false) nunca avisa.
//
// UMA MENSAGEM POR PAGAMENTO, não por conta: receber o saldo de um cliente
// com 8 compras em aberto grava 8 recebimentos, e 8 mensagens seguidas
// seriam spam. Junta o que for do mesmo lote, ou do mesmo cliente e forma
// no mesmo minuto (o PDV externo grava uma linha por conta, em sequência).

const TIPO_MENSAGEM = 'aviso_pagamento'
const REFERENCIA_TIPO = 'recebimento_aviso'
const JANELA_HORAS = 24

const FORMAS: Record<string, string> = {
  dinheiro: 'dinheiro', pix: 'PIX', debito: 'cartão de débito', credito: 'cartão de crédito',
  boleto: 'boleto', transferencia: 'transferência', credito_cliente: 'crédito da loja',
}

export type RecebimentoAviso = {
  id: string; empresa_id: string; cliente_id: string | null; valor: number | string
  forma_pagamento: string | null; created_at: string; lote_id: string | null
  avisar_cliente: boolean | null
}

type Sb = Parameters<typeof enviarWhatsappAutomacao>[0]
type Cli = {
  id: string; nome: string | null; empresa_id: string; telefone: string | null; whatsapp: string | null
  telefone_whatsapp: string | null; alerta_pedido_telefone: string | null; opt_out_whatsapp: boolean | null
  alerta_pagamento_whatsapp: boolean | null; saldo_devedor: number | string | null
}

const fmtMoeda = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Os recebimentos que devem gerar aviso, já juntos por pagamento. */
export function agruparPagamentos(
  recs: RecebimentoAviso[], clienteQuerAviso: (clienteId: string) => boolean,
): { chave: string; clienteId: string; empresaId: string; ids: string[]; valor: number; forma: string | null; em: string }[] {
  const grupos = new Map<string, { chave: string; clienteId: string; empresaId: string; ids: string[]; valor: number; forma: string | null; em: string }>()
  for (const r of recs) {
    if (!r.cliente_id) continue
    const avisar = r.avisar_cliente === true || (r.avisar_cliente === null && clienteQuerAviso(r.cliente_id))
    if (!avisar) continue
    const chave = r.lote_id ? `lote:${r.lote_id}` : `${r.cliente_id}|${r.forma_pagamento ?? ''}|${r.created_at.slice(0, 16)}`
    const g = grupos.get(chave) ?? { chave, clienteId: r.cliente_id, empresaId: r.empresa_id, ids: [], valor: 0, forma: r.forma_pagamento, em: r.created_at }
    g.ids.push(r.id)
    g.valor = Math.round((g.valor + Number(r.valor ?? 0)) * 100) / 100
    grupos.set(chave, g)
  }
  return [...grupos.values()]
}

export function mensagemDePagamento(p: { nome: string; loja: string; valor: number; forma: string | null; em: string; saldo: number }): string {
  const quando = new Date(p.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const forma = p.forma ? FORMAS[p.forma] ?? p.forma : null
  const primeiro = p.nome.trim().split(/\s+/)[0] || p.nome
  return `✅ *Pagamento recebido${p.loja ? ` — ${p.loja}` : ''}*\n\n` +
    `Olá, ${primeiro}! Recebemos o seu pagamento de *${fmtMoeda(p.valor)}*` +
    `${forma ? ` em ${forma}` : ''} (${quando}).\n\n` +
    (p.saldo > 0.009
      ? `Saldo em aberto na sua carteira: *${fmtMoeda(p.saldo)}*.`
      : `Sua carteira está *quitada*. Obrigado! 🙏`)
}

function telefoneDoAviso(cli: Cli): string | null {
  return cli.alerta_pedido_telefone || cli.telefone_whatsapp || cli.whatsapp || cli.telefone || null
}

export async function enviarAvisosDePagamento(sb: Sb): Promise<{ avisados: number; semTelefone: number; falhas: number }> {
  const desde = new Date(Date.now() - JANELA_HORAS * 3600_000).toISOString()
  // Só o que tem mais de 1 minuto: o PDV externo grava uma linha por conta,
  // em sequência, e ler no meio dela mandaria o pagamento em duas mensagens.
  const ate = new Date(Date.now() - 60_000).toISOString()
  const { data: recs } = await sb.from('recebimentos')
    .select('id, empresa_id, cliente_id, valor, forma_pagamento, created_at, lote_id, avisar_cliente')
    .is('aviso_enviado_em', null).gte('created_at', desde).lt('created_at', ate).not('cliente_id', 'is', null)
    .or('avisar_cliente.is.null,avisar_cliente.eq.true')
    .order('created_at', { ascending: true }).limit(2000)
  if (!recs?.length) return { avisados: 0, semTelefone: 0, falhas: 0 }

  const clienteIds = [...new Set((recs as RecebimentoAviso[]).map(r => r.cliente_id!))]
  const { data: clientes } = await sb.from('clientes')
    .select('id, nome, empresa_id, telefone, whatsapp, telefone_whatsapp, alerta_pedido_telefone, opt_out_whatsapp, alerta_pagamento_whatsapp, saldo_devedor')
    .in('id', clienteIds)
  const cliPorId = new Map<string, Cli>(((clientes ?? []) as Cli[]).map(c => [c.id, c]))
  const grupos = agruparPagamentos(recs as RecebimentoAviso[], id => !!cliPorId.get(id)?.alerta_pagamento_whatsapp)
  if (!grupos.length) return { avisados: 0, semTelefone: 0, falhas: 0 }

  const { data: contatos } = await sb.from('cliente_contatos')
    .select('cliente_id, telefone').in('cliente_id', [...new Set(grupos.map(g => g.clienteId))])
    .eq('recebe_avisos', true).eq('ativo', true)
  const empresaIds = [...new Set(grupos.map(g => g.empresaId))]
  const { data: empresas } = await sb.from('empresas').select('id, nome, nome_fantasia').in('id', empresaIds)
  const nomeLoja = new Map<string, string>(((empresas ?? []) as { id: string; nome: string | null; nome_fantasia: string | null }[]).map(e => [e.id, e.nome_fantasia || e.nome || '']))

  let avisados = 0, semTelefone = 0, falhas = 0
  for (const g of grupos) {
    const cli = cliPorId.get(g.clienteId)
    const marcar = () => sb.from('recebimentos').update({ aviso_enviado_em: new Date().toISOString() }).in('id', g.ids)
    // Cliente que pediu para não receber WhatsApp, ou sem número: marca como
    // tratado, senão a rotina tentaria de novo a cada 5 minutos.
    if (!cli || cli.opt_out_whatsapp) { await marcar(); continue }
    const destinos = [...new Set([telefoneDoAviso(cli), ...((contatos ?? []) as { cliente_id: string; telefone: string | null }[]).filter(c => c.cliente_id === cli.id).map(c => c.telefone)]
      .filter((t): t is string => !!t))]
    if (!destinos.length) { semTelefone++; await marcar(); continue }

    const mensagem = mensagemDePagamento({
      nome: cli.nome ?? '', loja: nomeLoja.get(g.empresaId) ?? '', valor: g.valor, forma: g.forma, em: g.em,
      saldo: Number(cli.saldo_devedor ?? 0),
    })
    let algumOk = false
    for (const destino of destinos) {
      const r = await enviarWhatsappAutomacao(sb, g.empresaId, destino, mensagem, {
        tipo: TIPO_MENSAGEM, cliente_id: cli.id, cliente_nome: cli.nome,
        referencia_tipo: REFERENCIA_TIPO, referencia_id: g.ids[0],
      })
      if (r.ok) algumOk = true
    }
    // Falhou (WhatsApp fora do ar, por exemplo): não marca, e a próxima
    // rodada tenta de novo enquanto estiver dentro da janela de 24 h.
    if (algumOk) { avisados++; await marcar() } else falhas++
  }
  return { avisados, semTelefone, falhas }
}
