// Regras PURAS do atendimento da Shopee (devoluções e avaliações) — sem banco
// nem API, para a tela e os testes.
//
// O CHAT com o comprador a Shopee não libera para o nosso tipo de app
// ("This app type has no permission to this API" em sellerchat, medido em
// 20/10/2026) — segue no Seller Centre / app da Shopee.

/** A resposta a uma avaliação fica pública no anúncio. */
export const LIMITE_RESPOSTA_AVALIACAO = 500

export type DevolucaoShopee = {
  returnSn: string
  canalId: string
  canalNome: string
  pedido: string
  /** Pedido no sistema (id), quando a venda foi sincronizada. */
  pedidoId: string | null
  status: string
  motivo: string
  textoComprador: string
  valor: number | null
  fotos: string[]
  itens: { nome: string; quantidade: number; foto: string | null }[]
  criadaEm: string
  /** Até quando a loja responde (aceitar, contestar, propor). */
  prazoLoja: string | null
  negociacao: string | null
  rastreio: string | null
}

export type AvaliacaoShopee = {
  commentId: number
  canalId: string
  canalNome: string
  nota: number
  texto: string
  comprador: string
  pedido: string
  itemId: string
  produto: { titulo: string; foto: string | null } | null
  fotos: string[]
  criadaEm: string
}

export const STATUS_DEVOLUCAO: Record<string, string> = {
  REQUESTED: 'pedido de devolução', PROCESSING: 'em andamento', ACCEPTED: 'aceita (aguardando o produto voltar)',
  JUDGING: 'em análise da Shopee', SELLER_DISPUTE: 'contestada pela loja', CLOSED: 'encerrada', CANCELLED: 'cancelada',
}
/** Status em que ainda há algo acontecendo. */
export const DEVOLUCAO_ABERTA = new Set(['REQUESTED', 'PROCESSING', 'ACCEPTED', 'JUDGING', 'SELLER_DISPUTE'])
/**
 * Status em que a LOJA ainda tem de responder — só neles o prazo vale. Em
 * "ACCEPTED" a loja já aceitou: medido em 20/10/2026, 10 devoluções aceitas
 * em agosto/setembro ainda traziam prazo, e virariam "prazo vencido" falso.
 */
export const DEVOLUCAO_LOJA_RESPONDE = new Set(['REQUESTED', 'PROCESSING', 'JUDGING'])

export const MOTIVO_DEVOLUCAO: Record<string, string> = {
  NONRECEIPT: 'não recebeu o produto', NOT_RECEIPT: 'não recebeu o produto',
  WRONG_ITEM: 'recebeu o produto errado', ITEM_WRONGDAMAGED: 'produto errado ou danificado',
  ITEM_DAMAGED: 'produto danificado', PHYSICAL_DMG: 'produto com dano físico', FUNCTIONAL_DMG: 'produto com defeito',
  DIFFERENT_DESCRIPTION: 'diferente do anúncio', DIFF_DESC: 'diferente do anúncio',
  ITEM_MISSING: 'faltou item no pacote', MUTUAL_AGREE: 'acordo com a loja', CHANGE_MIND: 'desistiu da compra',
  EXPECTATION_FAILED: 'não atendeu à expectativa', DEFECTIVE: 'produto com defeito', USED: 'produto usado', OTHER: 'outro motivo',
  // Vistos em 20/10/2026 sem tradução:
  ITEM_NOT_FIT: 'não serviu', DAMAGED_OTHERS: 'chegou danificado', SPILLED_CONTENTS: 'conteúdo vazou',
  NON_RECEIPT: 'não recebeu o produto', WRONG_ITEM_OTHERS: 'recebeu o produto errado', INCOMPLETE_PRODUCT: 'produto incompleto',
}

export const NEGOCIACAO: Record<string, string> = {
  PENDING_RESPOND: 'esperando a loja responder', PENDING_BUYER_RESPOND: 'esperando o comprador',
  TERMINATED: 'negociação encerrada', NO_NEGOTIATION: '',
}

const segParaIso = (s: unknown) => (typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null)

/** Linha crua de get_return_list → devolução da tela. */
export function lerDevolucao(r: any, canal: { id: string; nome: string }): DevolucaoShopee { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    returnSn: String(r?.return_sn ?? ''), canalId: canal.id, canalNome: canal.nome,
    pedido: String(r?.order_sn ?? ''), pedidoId: null,
    status: String(r?.status ?? ''),
    motivo: MOTIVO_DEVOLUCAO[String(r?.reason ?? '')] ?? String(r?.reason ?? '').toLowerCase().replace(/_/g, ' '),
    textoComprador: String(r?.text_reason ?? '').trim(),
    valor: typeof r?.refund_amount === 'number' ? r.refund_amount : null,
    fotos: (Array.isArray(r?.image) ? r.image : []).filter((u: unknown) => typeof u === 'string' && /^https:\/\//.test(u)),
    itens: (Array.isArray(r?.item) ? r.item : []).map((i: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      nome: String(i?.name ?? ''), quantidade: Number(i?.amount ?? 1), foto: Array.isArray(i?.images) && i.images[0] ? String(i.images[0]) : null,
    })),
    criadaEm: segParaIso(r?.create_time) ?? '',
    prazoLoja: DEVOLUCAO_LOJA_RESPONDE.has(String(r?.status ?? '')) ? segParaIso(r?.return_seller_due_date) ?? segParaIso(r?.due_date) : null,
    negociacao: NEGOCIACAO[String(r?.negotiation_status ?? '')] ?? null,
    rastreio: r?.tracking_number ? String(r.tracking_number) : null,
  }
}

/** Avaliação sem resposta da loja (a Shopee manda `comment_reply` quando há). */
export function semResposta(c: { comment_reply?: { reply?: string | null } | null }): boolean {
  return !String(c?.comment_reply?.reply ?? '').trim()
}

/** Pior nota primeiro (é a que mais pesa para quem lê); na mesma nota, a mais recente. */
export function ordenarAvaliacoes<T extends { nota: number; criadaEm: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => a.nota - b.nota || b.criadaEm.localeCompare(a.criadaEm))
}
