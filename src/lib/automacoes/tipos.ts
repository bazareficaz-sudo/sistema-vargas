export type ResultadoExecucao = { status: 'ok' | 'erro' | 'sem_acao'; erro?: string; avancarCursorPara?: string }

export function fmtMoeda(v: number) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Tipos avaliados 1x por dia, no horario_envio da regra (dedup por
// ultima_execucao_dia). Os demais tipos são "por evento": a cada passada do
// cron, buscam registros novos desde cursor_processado.
export const TIPOS_AGENDADOS_1X_DIA = new Set([
  'whatsapp_relatorio_diario', 'whatsapp_estoque_baixo', 'whatsapp_conta_receber', 'whatsapp_conta_pagar',
  'alerta_margem_baixa', 'alerta_produto_parado', 'alerta_inadimplencia', 'alerta_meta_vendas',
  'reposicao_minimo', 'reposicao_pedido_automatico', 'reposicao_curva_abc', 'reposicao_produto_parado',
])

export function horarioJaPassou(horarioEnvio: string | null): boolean {
  if (!horarioEnvio) return true
  const agora = new Date()
  const [h, m] = horarioEnvio.split(':').map(Number)
  const alvo = new Date(agora); alvo.setHours(h ?? 0, m ?? 0, 0, 0)
  return agora >= alvo
}

export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}
