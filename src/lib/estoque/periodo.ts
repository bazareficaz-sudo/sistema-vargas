export type PeriodoPreset = 'hoje' | 'ontem' | '7d' | '15d' | '30d' | 'mes' | 'mes_anterior' | '90d' | 'custom'

export const PERIODO_LABELS: Record<PeriodoPreset, string> = {
  hoje: 'Hoje', ontem: 'Ontem', '7d': 'Últimos 7 dias', '15d': 'Últimos 15 dias', '30d': 'Últimos 30 dias',
  mes: 'Este mês', mes_anterior: 'Mês anterior', '90d': 'Últimos 90 dias', custom: 'Personalizado',
}

export const PERIODO_OPCOES: PeriodoPreset[] = ['hoje', 'ontem', '7d', '15d', '30d', 'mes', 'mes_anterior', '90d', 'custom']

function diasAtras(base: Date, n: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

export function calcularPeriodo(preset: PeriodoPreset, de?: string, ate?: string, agora: Date = new Date()): { inicio: string; fim: string } {
  const fimHoje = new Date(agora)
  fimHoje.setHours(23, 59, 59, 999)

  switch (preset) {
    case 'hoje': {
      const inicio = new Date(agora); inicio.setHours(0, 0, 0, 0)
      return { inicio: inicio.toISOString(), fim: fimHoje.toISOString() }
    }
    case 'ontem': {
      const inicio = diasAtras(agora, 1)
      const fim = new Date(inicio); fim.setHours(23, 59, 59, 999)
      return { inicio: inicio.toISOString(), fim: fim.toISOString() }
    }
    case '7d': return { inicio: diasAtras(agora, 6).toISOString(), fim: fimHoje.toISOString() }
    case '15d': return { inicio: diasAtras(agora, 14).toISOString(), fim: fimHoje.toISOString() }
    case '90d': return { inicio: diasAtras(agora, 89).toISOString(), fim: fimHoje.toISOString() }
    case 'mes': {
      const inicio = new Date(agora.getFullYear(), agora.getMonth(), 1)
      return { inicio: inicio.toISOString(), fim: fimHoje.toISOString() }
    }
    case 'mes_anterior': {
      const inicio = new Date(agora.getFullYear(), agora.getMonth() - 1, 1)
      const fim = new Date(agora.getFullYear(), agora.getMonth(), 0); fim.setHours(23, 59, 59, 999)
      return { inicio: inicio.toISOString(), fim: fim.toISOString() }
    }
    case 'custom':
      return {
        inicio: de ? new Date(de + 'T00:00:00').toISOString() : diasAtras(agora, 29).toISOString(),
        fim: ate ? new Date(ate + 'T23:59:59').toISOString() : fimHoje.toISOString(),
      }
    case '30d':
    default:
      return { inicio: diasAtras(agora, 29).toISOString(), fim: fimHoje.toISOString() }
  }
}

export type TipoMovimentoExtrato =
  | 'venda' | 'devolucao' | 'venda_marketplace'
  | 'entrada_compra' | 'entrada_nfe'
  | 'transferencia_saida' | 'transferencia_entrada'
  | 'ajuste_entrada' | 'ajuste_saida'

export const TIPOS_MOVIMENTO: { value: TipoMovimentoExtrato; label: string }[] = [
  { value: 'venda', label: 'Venda (PDV)' },
  { value: 'devolucao', label: 'Devolução' },
  { value: 'venda_marketplace', label: 'Venda (marketplace)' },
  { value: 'entrada_compra', label: 'Entrada de compra' },
  { value: 'entrada_nfe', label: 'Entrada por NF-e' },
  { value: 'transferencia_saida', label: 'Transferência enviada' },
  { value: 'transferencia_entrada', label: 'Transferência recebida' },
  { value: 'ajuste_entrada', label: 'Ajuste — entrada' },
  { value: 'ajuste_saida', label: 'Ajuste — saída' },
]

export const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS_MOVIMENTO.map(t => [t.value, t.label]))
