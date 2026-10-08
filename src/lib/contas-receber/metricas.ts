// Cards do topo de Contas a Receber (Total em aberto, Vencido, Vence hoje,
// Próximos 30 dias). Um cálculo só, usado pelo servidor e pela tela — a tela
// recalcula quando o gestor escolhe um cliente ou recebe uma conta.
//
// VENCIDO É PELA DATA, NÃO PELO STATUS. O status "vencido" só é gravado por
// rotina; a conta que passou do vencimento pode continuar "aberto" por dias.
// Somar pelo status mostrava R$ 36,85 de vencido enquanto um único cliente
// tinha R$ 478,90 com 14 a 24 dias de atraso (medido em 08/10/2026).
//
// EM ABERTO inclui a vencida: é o que o cliente deve, ponto. A versão anterior
// somava só "aberto" e "parcial" e deixava a conta já marcada como vencida de
// fora do total.

export const STATUS_EM_ABERTO = ['aberto', 'parcial', 'vencido'] as const

export type ContaParaMetrica = {
  status: string
  data_vencimento: string
  valor_aberto: number | null
}

export type MetricasReceber = {
  totalAberto: number
  totalVencido: number
  totalHoje: number
  totalEm30: number
  /** Quantas contas entram em cada card — a tela usa no rótulo. */
  qtdAberto: number
  qtdVencido: number
}

function somarDias(diaISO: string, dias: number): string {
  const d = new Date(`${diaISO}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** `hoje` no formato AAAA-MM-DD. */
export function metricasContasReceber(contas: ContaParaMetrica[], hoje: string): MetricasReceber {
  const em30 = somarDias(hoje, 30)
  const m: MetricasReceber = { totalAberto: 0, totalVencido: 0, totalHoje: 0, totalEm30: 0, qtdAberto: 0, qtdVencido: 0 }
  for (const c of contas) {
    if (!(STATUS_EM_ABERTO as readonly string[]).includes(c.status)) continue
    const v = Number(c.valor_aberto ?? 0)
    if (v <= 0) continue
    m.totalAberto += v; m.qtdAberto++
    if (c.data_vencimento < hoje) { m.totalVencido += v; m.qtdVencido++ }
    else if (c.data_vencimento === hoje) m.totalHoje += v
    if (c.data_vencimento >= hoje && c.data_vencimento <= em30) m.totalEm30 += v
  }
  return m
}

/** Soma do que está em aberto nas contas escolhidas (seleção da tabela). */
export function somaEmAberto(contas: ContaParaMetrica[]): number {
  return contas.reduce((s, c) => s + Number(c.valor_aberto ?? 0), 0)
}
