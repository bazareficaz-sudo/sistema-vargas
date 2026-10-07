// Filtro de período do vencimento em Contas a Pagar.
//
// Tudo em datas AAAA-MM-DD (coluna `vencimento` é DATE, sem hora) e partindo
// de `hojeIso` resolvido no servidor em horário de Brasília — nunca do
// relógio do navegador nem do servidor (UTC).

export type Periodo = 'hoje' | 'semana' | 'mes' | 'proximo_mes' | 'custom'

export const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mês' },
  { id: 'proximo_mes', label: 'Próximo mês' },
  { id: 'custom', label: 'Período' },
]

export type Intervalo = { ini: string | null; fim: string | null }

const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/

export function periodoValido(v: string | undefined): Periodo | null {
  return PERIODOS.some(p => p.id === v) ? (v as Periodo) : null
}

// Calendário feito em UTC de propósito: as datas aqui são "só dia", e
// UTC não tem horário de verão nem fuso que desloque o dia ao somar.
function parse(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function somarDias(iso: string, dias: number): string {
  const d = parse(iso)
  d.setUTCDate(d.getUTCDate() + dias)
  return fmt(d)
}

/**
 * Intervalo [ini, fim] (inclusivo) do período, ou nulo quando não há recorte.
 * Semana vai de segunda a domingo. Em "Período", cada ponta é opcional.
 */
export function intervaloDoPeriodo(
  periodo: Periodo | null, hojeIso: string, de?: string, ate?: string,
): Intervalo | null {
  if (!periodo) return null
  switch (periodo) {
    case 'hoje':
      return { ini: hojeIso, fim: hojeIso }
    case 'semana': {
      const diaSemana = parse(hojeIso).getUTCDay() // 0 = domingo
      const desdeSegunda = (diaSemana + 6) % 7
      const segunda = somarDias(hojeIso, -desdeSegunda)
      return { ini: segunda, fim: somarDias(segunda, 6) }
    }
    case 'mes': {
      const h = parse(hojeIso)
      const ini = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1))
      const fim = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() + 1, 0))
      return { ini: fmt(ini), fim: fmt(fim) }
    }
    case 'proximo_mes': {
      const h = parse(hojeIso)
      const ini = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() + 1, 1))
      const fim = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() + 2, 0))
      return { ini: fmt(ini), fim: fmt(fim) }
    }
    case 'custom': {
      const ini = de && DATA_VALIDA.test(de) ? de : null
      const fim = ate && DATA_VALIDA.test(ate) ? ate : null
      return ini || fim ? { ini, fim } : null
    }
  }
}

export function rotuloIntervalo(i: Intervalo | null): string {
  if (!i) return ''
  const br = (iso: string) => iso.split('-').reverse().join('/')
  if (i.ini && i.fim) return i.ini === i.fim ? br(i.ini) : `${br(i.ini)} a ${br(i.fim)}`
  if (i.ini) return `a partir de ${br(i.ini)}`
  if (i.fim) return `até ${br(i.fim)}`
  return ''
}

export const STATUS_VALIDOS = ['pendente', 'vencido', 'pago', 'cancelado'] as const

/** `status=pendente,vencido` → lista; `todos`/vazio/inválido → nulo (sem recorte). */
export function statusDaUrl(valor: string | undefined): string[] | null {
  if (!valor || valor === 'todos') return null
  const lista = valor.split(',').map(s => s.trim()).filter(s => (STATUS_VALIDOS as readonly string[]).includes(s))
  return lista.length ? [...new Set(lista)] : null
}
