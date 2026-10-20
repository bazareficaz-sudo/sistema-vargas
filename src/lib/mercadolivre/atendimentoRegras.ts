// Regras PURAS do atendimento do Mercado Livre (perguntas, reclamações e
// mensagens) — sem banco nem API, para a tela e os testes.

/** Limite do ML para a resposta de uma pergunta. */
export const LIMITE_RESPOSTA_PERGUNTA = 2000
/** Limite do ML para mensagem pós-venda ao comprador. */
export const LIMITE_MENSAGEM_POS_VENDA = 350

export type PerguntaML = {
  id: number
  canalId: string
  canalNome: string
  texto: string
  criadaEm: string
  itemId: string
  item: { titulo: string; foto: string | null; preco: number | null; estoque: number | null; link: string | null } | null
  /** Produto do sistema ligado ao anúncio (para a IA e para o atendente). */
  produtoId: string | null
}

export type MensagemReclamacao = { de: 'comprador' | 'vendedor' | 'mediador'; texto: string; em: string }

export type ReclamacaoML = {
  id: number
  canalId: string
  canalNome: string
  tipo: string
  etapa: string
  motivo: string
  criadaEm: string
  pedidoExterno: string | null
  /** Pedido no sistema (id), quando a venda foi sincronizada. */
  pedidoId: string | null
  acoes: string[]
  prazo: string | null
  mensagens: MensagemReclamacao[]
}

export type MensagemConversa = { daLoja: boolean; texto: string; em: string }

export type ConversaML = {
  packId: string
  canalId: string
  canalNome: string
  compradorId: string | null
  naoLidas: number
  mensagens: MensagemConversa[]
  /** Reclamação ligada à conversa: aí a conversa é pela reclamação. */
  temReclamacao: boolean
}

/** O prazo mais próximo das ações que o vendedor pode tomar numa reclamação. */
export function prazoDaReclamacao(players: { role?: string; available_actions?: { action?: string; due_date?: string | null }[] }[] | null | undefined): string | null {
  const vendedor = (players ?? []).find(p => p.role === 'respondent')
  const prazos = (vendedor?.available_actions ?? []).map(a => a.due_date).filter((d): d is string => Boolean(d)).sort()
  return prazos[0] ?? null
}

export function acoesDoVendedor(players: { role?: string; available_actions?: { action?: string }[] }[] | null | undefined): string[] {
  const vendedor = (players ?? []).find(p => p.role === 'respondent')
  return (vendedor?.available_actions ?? []).map(a => String(a.action ?? '')).filter(Boolean)
}

/** O que cada ação do vendedor significa, em português. */
export const ROTULO_ACAO: Record<string, string> = {
  send_message_to_complainant: 'responder o comprador',
  send_message_to_mediator: 'falar com a mediação',
  refund: 'devolver o dinheiro',
  allow_return: 'aceitar a devolução',
  allow_partial_refund: 'devolver parte do dinheiro',
  open_dispute: 'pedir mediação do Mercado Livre',
  send_potential_shipping: 'informar o envio',
  add_shipping_evidence: 'mandar comprovante de envio',
}

export const ROTULO_ETAPA: Record<string, string> = { claim: 'reclamação', dispute: 'em mediação', recontact: 'recontato', none: '' }

/** "3 h", "2 d" — quanto tempo desde `iso`. */
export function tempoDesde(iso: string, agora: Date = new Date()): string {
  const horas = Math.max(0, (agora.getTime() - new Date(iso).getTime()) / 3_600_000)
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} min`
  if (horas < 48) return `${Math.floor(horas)} h`
  return `${Math.floor(horas / 24)} d`
}

/** Quanto falta até o prazo; negativo = vencido. */
export function horasAte(iso: string, agora: Date = new Date()): number {
  return (new Date(iso).getTime() - agora.getTime()) / 3_600_000
}

/**
 * O Mercado Livre proíbe dado de contato fora da plataforma (telefone,
 * e-mail, link) em pergunta e mensagem — a resposta é moderada ou a conta
 * leva advertência. Avisa ANTES de enviar.
 */
export function avisoDeContato(texto: string): string | null {
  const t = texto.toLowerCase()
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) return 'tem um e-mail'
  if (/(https?:\/\/|www\.|\.com\b|\.com\.br\b)/.test(t)) return 'tem um link'
  if (/\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/.test(t)) return 'parece ter um telefone'
  if (/whats\s?app|wpp|zap\b|instagram|insta\b/.test(t)) return 'cita WhatsApp ou rede social'
  return null
}

export type ResumoAtendimentoML = {
  perguntas: number
  reclamacoes: number
  /** Reclamações com prazo do vendedor em menos de 24 h (ou vencido). */
  urgentes: number
  /** O prazo mais próximo entre as reclamações abertas. */
  proximoPrazo: string | null
}

/** O cartão do Início: soma das contas, a partir do que a API devolveu. */
export function resumirAtendimento(
  contas: { perguntas: number; reclamacoes: { players?: Parameters<typeof prazoDaReclamacao>[0] }[] }[],
  agora: Date = new Date(),
): ResumoAtendimentoML {
  const prazos = contas.flatMap(c => c.reclamacoes.map(r => prazoDaReclamacao(r.players))).filter((p): p is string => Boolean(p)).sort()
  return {
    perguntas: contas.reduce((s, c) => s + c.perguntas, 0),
    reclamacoes: contas.reduce((s, c) => s + c.reclamacoes.length, 0),
    urgentes: prazos.filter(p => horasAte(p, agora) < 24).length,
    proximoPrazo: prazos[0] ?? null,
  }
}
