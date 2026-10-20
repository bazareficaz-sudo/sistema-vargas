// Estoque mínimo em massa: a mesma quantidade para todos, ou "N dias de
// venda" — a média diária de cada produto (calculada pela rotina de
// reposição, em reposicao_metricas) vezes os dias que se quer de cobertura.

/** Mínimo para cobrir `dias` de venda. Vendeu alguma coisa: pelo menos 1. */
export function minimoPorDias(mediaDiaria: number | null | undefined, dias: number): number | null {
  const m = Number(mediaDiaria ?? 0)
  if (!(m > 0) || !(dias > 0)) return null
  return Math.max(1, Math.ceil(m * dias))
}

/**
 * O mínimo de cada produto, agrupado por valor (uma gravação por valor, e
 * não uma por produto). Produto sem venda fica de fora, ou recebe
 * `semVenda` quando ele é informado.
 */
export function minimosPorValor(
  ids: string[], mediaPorProduto: Map<string, number>, dias: number, semVenda: number | null,
): { porValor: Map<number, string[]>; comVenda: number; semVendaQtd: number } {
  const porValor = new Map<number, string[]>()
  let comVenda = 0, semVendaQtd = 0
  for (const id of ids) {
    let v = minimoPorDias(mediaPorProduto.get(id), dias)
    if (v === null) { semVendaQtd++; v = semVenda } else comVenda++
    if (v === null) continue
    porValor.set(v, [...(porValor.get(v) ?? []), id])
  }
  return { porValor, comVenda, semVendaQtd }
}
