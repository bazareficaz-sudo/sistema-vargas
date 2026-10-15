import { preencherResposta } from './conversas'

// RESPOSTA AUTOMÁTICA FORA DO HORÁRIO (migração 20261017180000_whatsapp_fora_horario.sql).
// Aqui só as regras puras (usadas também na tela); o envio está em foraHorarioEnvio.ts.
//
// Quem escreve com a loja fechada recebe uma mensagem curta com o horário,
// para não ficar sem resposta até o dia seguinte. Regras:
//   • desligada até a loja ligar (whatsapp_config.fora_horario_ativo);
//   • só para contato (quem procurou a loja) — dono e equipe nem viram contato;
//   • uma por contato por dia, marcada ANTES de enviar (UPDATE condicional);
//   • não responde se alguém da loja respondeu nos últimos 30 min (está atendendo);
//   • respeita opt-out e não envia para número oculto;
//   • não conta como resposta: a conversa continua "aguardando".

export type Turno = { abre: string; fecha: string }
/** 0 = domingo … 6 = sábado; null/ausente = fechado. */
export type HorarioSemana = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', Turno | null>>

export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const
export const MENSAGEM_PADRAO = 'Olá{, nome}! Aqui é da {loja}. Recebemos sua mensagem 😊\nNosso horário de atendimento é {horario}. Respondemos assim que abrirmos!'
export const HORARIO_SUGERIDO: HorarioSemana = {
  0: null, 1: { abre: '08:00', fecha: '18:00' }, 2: { abre: '08:00', fecha: '18:00' }, 3: { abre: '08:00', fecha: '18:00' },
  4: { abre: '08:00', fecha: '18:00' }, 5: { abre: '08:00', fecha: '18:00' }, 6: { abre: '08:00', fecha: '12:00' },
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** Só turnos válidos (HH:MM, abre antes de fecha). Nenhum dia aberto → nulo. */
export function horarioValido(v: unknown): HorarioSemana | null {
  if (!v || typeof v !== 'object') return null
  const out: HorarioSemana = {}
  let algum = false
  for (let d = 0; d < 7; d++) {
    const t = (v as Record<string, unknown>)[String(d)] as Partial<Turno> | null | undefined
    const ok = t && typeof t.abre === 'string' && typeof t.fecha === 'string' && HORA.test(t.abre) && HORA.test(t.fecha) && minutos(t.abre) < minutos(t.fecha)
    out[String(d) as keyof HorarioSemana] = ok ? { abre: t!.abre!, fecha: t!.fecha! } : null
    if (ok) algum = true
  }
  return algum ? out : null
}

/** Dia da semana e minutos do dia no fuso da loja. */
function agoraNaLoja(agora: Date): { dia: number; min: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(agora)
  const v = (t: string) => p.find(x => x.type === t)?.value ?? ''
  return { dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday')), min: Number(v('hour')) * 60 + Number(v('minute')) }
}

/** A loja está aberta agora? (início incluído, fim não) */
export function lojaAberta(semana: HorarioSemana, agora: Date = new Date()): boolean {
  const { dia, min } = agoraNaLoja(agora)
  const t = semana[String(dia) as keyof HorarioSemana]
  return Boolean(t && min >= minutos(t.abre) && min < minutos(t.fecha))
}

const hora = (h: string) => (h.endsWith(':00') ? `${Number(h.slice(0, 2))}h` : `${Number(h.slice(0, 2))}h${h.slice(3)}`)

/** "seg a sex, 8h às 18h; sáb, 8h às 12h" — dias seguidos com o mesmo turno juntos. */
export function descreverHorario(semana: HorarioSemana): string {
  const ordem = [1, 2, 3, 4, 5, 6, 0]
  const grupos: { dias: number[]; t: Turno }[] = []
  for (const d of ordem) {
    const t = semana[String(d) as keyof HorarioSemana]
    if (!t) continue
    const ult = grupos[grupos.length - 1]
    const seguido = ult && ordem.indexOf(ult.dias[ult.dias.length - 1]) === ordem.indexOf(d) - 1
    if (ult && seguido && ult.t.abre === t.abre && ult.t.fecha === t.fecha) ult.dias.push(d)
    else grupos.push({ dias: [d], t })
  }
  return grupos.map(g => {
    const dias = g.dias.length === 1 ? DIAS[g.dias[0]] : g.dias.length === 2 ? `${DIAS[g.dias[0]]} e ${DIAS[g.dias[1]]}` : `${DIAS[g.dias[0]]} a ${DIAS[g.dias[g.dias.length - 1]]}`
    return `${dias}, ${hora(g.t.abre)} às ${hora(g.t.fecha)}`
  }).join('; ')
}

/** Texto final: {nome} (primeiro nome), {loja}, {horario}. */
export function mensagemForaHorario(modelo: string | null | undefined, d: { nome?: string | null; loja?: string | null; horario: string }): string {
  const base = (modelo?.trim() || MENSAGEM_PADRAO).replace(/\{horario\}/gi, d.horario)
  return preencherResposta(base, { nome: d.nome, loja: d.loja }).trim()
}
