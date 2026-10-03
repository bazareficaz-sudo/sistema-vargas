export type ResultadoExecucao = { status: 'ok' | 'erro' | 'sem_acao'; erro?: string; avancarCursorPara?: string }

// Quantos pedidos a regra de NF-e de marketplace emite numa rodada. Aqui, e
// não em tipos-nfe-marketplace.ts, porque a tela também mostra o número — e
// aquele arquivo puxa código de servidor que não pode ir para o navegador.
export const LIMITE_NFE_MARKETPLACE_POR_RODADA = 40

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

// HORÁRIO DAS REGRAS — sempre no relógio de Brasília.
//
// O horário que o usuário digita ("08:00") é hora de Brasília. O servidor
// (Vercel) roda em UTC. A versão anterior comparava com `setHours` e
// `toISOString`, ou seja, em UTC: medido em produção, a regra das 08:00
// rodava às 05:00 e a das 18:10 às 15:10 — três horas antes. E "hoje"
// virava amanhã às 21:00.
//
// O Brasil não tem horário de verão desde 2019, então o fuso é fixo (-03:00);
// mesmo assim a conta sai do Intl, que sabe disso sozinho.
const FUSO = 'America/Sao_Paulo'

function partesEmBrasilia(agora: Date): { data: string; minutos: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).map(x => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) }
}

/** "08:00", "8:5" → minutos do dia; inválido → null. */
function minutosDe(horario: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(horario.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/** Um ou vários horários ("10:00, 14:30") — ordenados, sem repetição. */
export function horariosDaRegra(texto: string | null): string[] {
  const lista = String(texto ?? '').split(/[,;\s]+/).filter(h => minutosDe(h) != null)
    .map(h => { const t = minutosDe(h)!; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` })
  return [...new Set(lista)].sort()
}

export function horarioJaPassou(horarioEnvio: string | null, agora = new Date()): boolean {
  if (!horarioEnvio) return true
  const alvo = minutosDe(horarioEnvio)
  if (alvo == null) return true
  return partesEmBrasilia(agora).minutos >= alvo
}

export function hojeISO(agora = new Date()): string {
  return partesEmBrasilia(agora).data
}

/**
 * Regra de horário marcado: há um horário de HOJE que já passou e que ainda
 * não teve a sua rodada? Com vários horários ("10:00, 14:00"), cada um vale
 * uma rodada — a das 14:00 roda mesmo que a das 10:00 já tenha rodado.
 */
export function horarioMarcadoVenceu(horarios: string | null, ultimaExecucao: string | null, agora = new Date()): boolean {
  const { data, minutos } = partesEmBrasilia(agora)
  const ultima = ultimaExecucao ? new Date(ultimaExecucao).getTime() : 0
  return horariosDaRegra(horarios).some(h => {
    if (minutosDe(h)! > minutos) return false
    const instante = new Date(`${data}T${h}:00-03:00`).getTime()
    return ultima < instante
  })
}
