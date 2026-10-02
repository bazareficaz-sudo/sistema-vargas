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

// Horário e "dia" das automações são os do Brasil. O servidor roda em UTC
// (sem TZ configurado na Vercel): sem isto, "18:10" disparava às 15:10 de
// Brasília e a virada do dia caía às 21h.
const FUSO = 'America/Sao_Paulo'

function agoraNoFuso(): { hora: number; minuto: number } {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const num = (tipo: string) => Number(partes.find(p => p.type === tipo)?.value ?? 0)
  return { hora: num('hour'), minuto: num('minute') }
}

export function horarioJaPassou(horarioEnvio: string | null): boolean {
  if (!horarioEnvio) return true
  const [h, m] = horarioEnvio.split(':').map(Number)
  const { hora, minuto } = agoraNoFuso()
  return hora * 60 + minuto >= (h ?? 0) * 60 + (m ?? 0)
}

export function hojeISO(): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date())
}
