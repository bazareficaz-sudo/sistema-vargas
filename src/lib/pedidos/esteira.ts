// ESTEIRA DE PEDIDOS — em que passo do despacho cada pedido de marketplace
// está, numa régua só para todos os canais:
//
//   1 Novos → 2 Emitir NF → 3 Imprimir etiqueta → 4 Aguardando postagem → Enviado
//
// Calculada, não gravada: cada passo sai de um fato que já existe (status do
// canal, nota registrada, etiqueta impressa, prazo de postagem). Assim a
// esteira anda sozinha quando a nota ou a etiqueta são feitas FORA do
// sistema — o canal avisa no próximo sync e o pedido muda de passo, sem
// ninguém arrastar nada.
//
// Substitui, na tela de Pedidos de E-commerce, as abas antigas
// (Reservar/Mapear/Para Emitir/A Enviar/Imprimir) e os cards de status
// comercial, que respondiam perguntas diferentes e não diziam o que falta
// sair hoje.

export type EtapaEsteira =
  | 'pendencia' | 'novos' | 'emitir' | 'imprimir' | 'postagem'
  | 'enviado' | 'entregue' | 'cancelado'

export const ESTEIRA: { valor: EtapaEsteira; numero?: number; label: string; ajuda: string; cor: string }[] = [
  { valor: 'novos',     numero: 1, label: 'Novos',               cor: 'bg-blue-100 text-blue-700',
    ajuda: 'Pedidos com prazo de postagem depois de hoje, ou ainda sem pagamento. Entram em "Emitir NF" no dia de sair.' },
  { valor: 'emitir',    numero: 2, label: 'Emitir NF',           cor: 'bg-indigo-100 text-indigo-700',
    ajuda: 'Saem hoje (ou estão atrasados) e o canal ainda não recebeu a nota fiscal.' },
  { valor: 'imprimir',  numero: 3, label: 'Imprimir etiqueta',   cor: 'bg-violet-100 text-violet-700',
    ajuda: 'Nota resolvida; falta imprimir a etiqueta de envio.' },
  { valor: 'postagem',  numero: 4, label: 'Aguardando postagem', cor: 'bg-teal-100 text-teal-700',
    ajuda: 'Etiqueta impressa. Falta levar à agência ou entregar na coleta.' },
  { valor: 'enviado',   label: 'Enviados',   cor: 'bg-cyan-100 text-cyan-700',    ajuda: 'O canal confirmou a saída.' },
  { valor: 'entregue',  label: 'Entregues',  cor: 'bg-green-100 text-green-700',  ajuda: 'Entregues ao comprador.' },
  { valor: 'pendencia', label: 'Pendências', cor: 'bg-amber-100 text-amber-800',
    ajuda: 'Item sem produto vinculado ou estoque não baixado. Resolva antes de despachar.' },
  { valor: 'cancelado', label: 'Cancelados', cor: 'bg-gray-100 text-gray-500',    ajuda: 'Cancelados ou devolvidos.' },
]

export const ESTEIRA_INFO: Record<EtapaEsteira, (typeof ESTEIRA)[number]> =
  Object.fromEntries(ESTEIRA.map(e => [e.valor, e])) as any

// Fim do dia de HOJE no relógio de quem está olhando. O prazo de postagem é
// "até o fim do dia X" em todos os canais (ML diz isso com todas as letras:
// só a data conta), então "sai hoje" = prazo até 23:59:59 de hoje.
export function fimDeHoje(agora = new Date()): Date {
  const d = new Date(agora)
  d.setHours(23, 59, 59, 999)
  return d
}

// A nota já foi resolvida para este pedido? Vale a nota registrada aqui, e
// vale o CANAL dizendo que não espera mais nota — que é como a esteira
// enxerga uma nota emitida em outro sistema.
export function notaResolvida(p: any): boolean {
  if (p.nfe_informada_em) return true
  const plataforma = p.marketplace_canais?.plataforma
  const ext = String(p.status_externo ?? '').toUpperCase()

  if (plataforma === 'mercadolivre') {
    // ready_to_ship/invoice_pending = falta nota; qualquer outro substatus
    // de ready_to_ship (ready_to_print, printed, ...) = nota aceita.
    return p.envio_status === 'ready_to_ship' && p.envio_substatus !== 'invoice_pending'
  }
  if (plataforma === 'shopee') {
    // No Brasil a Shopee segura o pedido em INVOICE_PENDING até receber a
    // nota; daí em diante ele já está liberado para envio.
    return ext === 'READY_TO_SHIP' || ext === 'PROCESSED' || ext === 'RETRY_SHIP'
  }
  if (plataforma === 'tiktok') {
    if (ext === 'AWAITING_COLLECTION') return true
    // A listagem traz o campo extraído (sem o JSON inteiro); o detalhe pode
    // ter o dados_brutos completo.
    const inv = p.need_upload_invoice ?? p.dados_brutos?.need_upload_invoice
    return ext === 'AWAITING_SHIPMENT' && !!inv && inv !== 'NEED_INVOICE'
  }
  return false
}

// Substatus do shipment do Mercado Livre que só existem DEPOIS de a etiqueta
// sair da impressora (impressa, na lista de coleta/embalagem, pronta para a
// coleta, deixada na agência, já no centro do ML). Serve para a esteira
// reconhecer a etiqueta impressa em outro sistema.
const SUBSTATUS_ML_JA_IMPRESSO = new Set([
  'printed', 'in_pickup_list', 'in_packing_list', 'ready_for_pickup',
])

// Pacote que já saiu do galpão — entregue na agência, coletado ou já no
// centro do ML — mas cujo shipment ainda diz ready_to_ship até o primeiro
// escaneamento. Para a esteira, já foi postado.
const SUBSTATUS_ML_JA_POSTADO = new Set(['dropped_off', 'picked_up', 'in_hub'])

export function etiquetaImpressa(p: any): boolean {
  return !!p.etiqueta_impressa_em || SUBSTATUS_ML_JA_IMPRESSO.has(String(p.envio_substatus ?? ''))
}

export function etapaEsteira(p: any, agora = new Date()): EtapaEsteira {
  const st = p.status
  const ei = p.etapa_interna

  // TO_RETURN (Shopee): pedido em devolução — saiu do fluxo de despacho.
  const ext = String(p.status_externo ?? '').toUpperCase()
  if (st === 'cancelado' || st === 'devolvido' || ei === 'cancelado' || ext === 'TO_RETURN') return 'cancelado'
  if (st === 'entregue' || ei === 'concluido') return 'entregue'
  if (st === 'enviado' || ei === 'enviado') return 'enviado'
  if (SUBSTATUS_ML_JA_POSTADO.has(String(p.envio_substatus ?? ''))) return 'enviado'
  // Sem pagamento confirmado não se despacha nada — fica em Novos.
  if (st === 'novo') return 'novos'

  const itens: any[] = p.marketplace_pedido_itens ?? []
  if (ei === 'com_pendencia' || ei === 'pendencia_mapeamento' || itens.some(i => !i.produto_id)) return 'pendencia'

  if (etiquetaImpressa(p)) return 'postagem'
  if (notaResolvida(p)) return 'imprimir'

  if (p.prazo_postagem && new Date(p.prazo_postagem) > fimDeHoje(agora)) return 'novos'
  return 'emitir'
}

// Etapas em que o pedido ainda está na mão do galpão (o prazo importa).
export function emAberto(e: EtapaEsteira): boolean {
  return e === 'novos' || e === 'emitir' || e === 'imprimir' || e === 'postagem' || e === 'pendencia'
}

export type Janela = 'hoje' | 'atrasado' | 'futuro' | 'sem_prazo'

// Quando o pedido tem de sair, em relação a hoje. Pedido sem prazo conta
// como "hoje": é mais seguro tratar como urgente do que esquecer.
export function janelaDoPrazo(p: any, agora = new Date()): Janela {
  if (!p.prazo_postagem) return 'sem_prazo'
  const prazo = new Date(p.prazo_postagem)
  if (prazo < agora) return 'atrasado'
  if (prazo <= fimDeHoje(agora)) return 'hoje'
  return 'futuro'
}

export function textoPrazo(p: any, agora = new Date()): { texto: string; cor: string } | null {
  if (!p.prazo_postagem) return null
  const prazo = new Date(p.prazo_postagem)
  const diffH = (prazo.getTime() - agora.getTime()) / 3_600_000
  if (diffH < 0) {
    const h = Math.abs(diffH)
    return { texto: `Atrasado ${h < 24 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd'}`, cor: 'text-red-600 font-medium' }
  }
  if (prazo <= fimDeHoje(agora)) return { texto: 'Sai hoje', cor: 'text-orange-600 font-medium' }
  const amanha = fimDeHoje(new Date(agora.getTime() + 86_400_000))
  if (prazo <= amanha) return { texto: 'Amanhã', cor: 'text-gray-600' }
  return { texto: prazo.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), cor: 'text-gray-500' }
}
