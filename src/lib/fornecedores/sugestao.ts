// Sugestão de fornecedor, sem escolher sozinho.
//
// Item 20 do pedido original é explícito: "não selecionar automaticamente
// sem permitir revisão humana". Esta função só ordena e explica — quem
// aperta o botão do pedido é sempre o comprador.

export type OpcaoFornecedor = {
  fornecedorId: string
  nome: string
  custoUltimo: number | null
  prazoDias: number | null       // real, quando existe; senão cadastrado
  prazoReal: boolean
  comprasContadas: number
  ultimaCompraEm: string | null
  preferencial: boolean
  quantidadeMinima: number | null
}

export type Recomendacao = {
  fornecedorId: string
  motivos: string[]
}

const DIA = 86_400_000

/**
 * Ordena por: preferencial > preço > prazo > confiabilidade (nº de
 * compras). Preferencial vence mesmo custando um pouco mais — é uma
 * decisão que o comprador já tomou antes, ao marcar a preferência; a
 * função não deveria reabrir essa discussão a cada cálculo.
 */
export function sugerirFornecedor(opcoes: OpcaoFornecedor[]): Recomendacao | null {
  const comCusto = opcoes.filter(o => o.custoUltimo !== null && o.custoUltimo > 0)
  if (comCusto.length === 0) return null

  const menorCusto = Math.min(...comCusto.map(o => o.custoUltimo!))

  const pontuadas = comCusto.map(o => {
    let score = 0
    const motivos: string[] = []

    if (o.preferencial) { score += 50; motivos.push('marcado como preferencial') }

    const diffPct = (o.custoUltimo! - menorCusto) / menorCusto
    if (diffPct === 0) motivos.push('menor custo entre os fornecedores')
    else motivos.push(`custo ${Math.round(diffPct * 100)}% acima do menor`)
    score += Math.max(0, 20 - diffPct * 100)

    if (o.prazoDias !== null) {
      score += Math.max(0, 15 - o.prazoDias)
      motivos.push(o.prazoReal ? `entrega em média ${o.prazoDias} dia(s), medido nas últimas compras` : `entrega cadastrada em ~${o.prazoDias} dia(s)`)
    }

    if (o.comprasContadas >= 3) { score += 10; motivos.push(`${o.comprasContadas} compras anteriores`) }
    else if (o.comprasContadas > 0) { score += 3 }

    if (o.ultimaCompraEm) {
      const diasDesde = Math.floor((Date.now() - new Date(o.ultimaCompraEm).getTime()) / DIA)
      if (diasDesde > 180) { score -= 8; motivos.push(`sem comprar deste fornecedor há ${diasDesde} dias`) }
    }

    return { fornecedorId: o.fornecedorId, score, motivos }
  })

  pontuadas.sort((a, b) => b.score - a.score)
  const vencedor = pontuadas[0]
  return { fornecedorId: vencedor.fornecedorId, motivos: vencedor.motivos }
}
