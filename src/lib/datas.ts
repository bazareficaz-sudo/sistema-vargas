// Início de dia e de mês no fuso da loja.
//
// O servidor da Vercel roda em UTC; a loja vende em São Paulo. `new Date()`
// com `setHours(0,0,0,0)` no servidor devolve meia-noite EM UTC — que é 21h do
// dia anterior em São Paulo. Com isso, "vendas de hoje" começava incluindo as
// três últimas horas de ontem, e o mês começava às 21h do dia 31.
//
// O Brasil não tem mais horário de verão desde 2019, então o deslocamento é
// fixo em −3h. Se um dia voltar, este é o único arquivo a mudar.

const OFFSET_SP_MIN = -180

/** Partes do relógio de parede em São Paulo, no instante dado. */
function relogioSP(instante: Date) {
  const deslocado = new Date(instante.getTime() + OFFSET_SP_MIN * 60_000)
  return {
    ano: deslocado.getUTCFullYear(),
    mes: deslocado.getUTCMonth(),
    dia: deslocado.getUTCDate(),
  }
}

/** O instante em que começou o dia de hoje em São Paulo. */
export function inicioDoDia(agora: Date = new Date()): Date {
  const { ano, mes, dia } = relogioSP(agora)
  return new Date(Date.UTC(ano, mes, dia) - OFFSET_SP_MIN * 60_000)
}

/** O instante em que começou o mês corrente em São Paulo. */
export function inicioDoMes(agora: Date = new Date()): Date {
  const { ano, mes } = relogioSP(agora)
  return new Date(Date.UTC(ano, mes, 1) - OFFSET_SP_MIN * 60_000)
}

/** O instante em que começa o mês seguinte — fim EXCLUSIVO de um mês. */
export function inicioDoProximoMes(agora: Date = new Date()): Date {
  const { ano, mes } = relogioSP(agora)
  return new Date(Date.UTC(ano, mes + 1, 1) - OFFSET_SP_MIN * 60_000)
}

/** O instante em que começou o mês anterior em São Paulo. */
export function inicioDoMesAnterior(agora: Date = new Date()): Date {
  const { ano, mes } = relogioSP(agora)
  return new Date(Date.UTC(ano, mes - 1, 1) - OFFSET_SP_MIN * 60_000)
}

/** Começo do dia, `dias` atrás, em São Paulo. */
export function inicioDeDiasAtras(dias: number, agora: Date = new Date()): Date {
  const { ano, mes, dia } = relogioSP(agora)
  return new Date(Date.UTC(ano, mes, dia - dias) - OFFSET_SP_MIN * 60_000)
}

/** AAAA-MM-DD do dia em São Paulo — para comparar com colunas `date`. */
export function diaISO(instante: Date = new Date()): string {
  const { ano, mes, dia } = relogioSP(instante)
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}
