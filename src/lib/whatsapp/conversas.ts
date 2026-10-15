// Caixa de entrada do WhatsApp: regras de exibição das conversas (sem banco).

/** Mensagem do cliente fica à esquerda; tudo que a loja mandou, à direita. */
export const doCliente = (tipo: string) => tipo === 'recebida'

const ROTULO: Record<string, string> = {
  atendimento: 'Atendimento', enviada_celular: 'Pelo celular', manual: 'Manual',
  orcamento: 'Orçamento', cupom: 'Cupom', comprovante_venda: 'Comprovante', cobranca: 'Cobrança',
  catalogo: 'Catálogo', produto_individual: 'Produto', confirmacao_pag: 'Confirmação de pagamento',
  lembrete_venc: 'Lembrete', pos_venda: 'Pós-venda', automacao_alerta_pedido: 'Aviso de pedido',
  automacao_whatsapp_aviso_falta_chegou: 'Aviso: chegou',
}
/** Rótulo do que a loja mandou (nada para conversa comum). */
export function rotuloSaida(tipo: string): string | null {
  if (tipo === 'recebida' || tipo === 'atendimento') return null
  return ROTULO[tipo] ?? (tipo.startsWith('automacao_') ? 'Automação' : tipo)
}

/** "agora", "12 min", "3 h", "2 dias" desde a última mensagem sem resposta. */
export function tempoDeEspera(desde: string | Date, agora: Date = new Date()): string {
  const min = Math.max(0, Math.floor((agora.getTime() - new Date(desde).getTime()) / 60_000))
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return `${d} dia${d === 1 ? '' : 's'}`
}
