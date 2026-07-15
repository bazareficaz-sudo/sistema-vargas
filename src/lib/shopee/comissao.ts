// Tabela de comissão da Shopee por faixa de valor do item (percentual + valor
// fixo em R$), com o subsídio Pix adicional cobrado do vendedor quando o
// pedido é pago via Pix. Atualizar aqui se a Shopee mudar as faixas/taxas.
export type FaixaComissao = { min: number; max: number; percentual: number; fixo: number; subsidioPix: number }

export const FAIXAS_COMISSAO_SHOPEE: FaixaComissao[] = [
  { min: 0,   max: 79.99,    percentual: 20, fixo: 4,  subsidioPix: 0 },
  { min: 80,  max: 99.99,    percentual: 14, fixo: 16, subsidioPix: 5 },
  { min: 100, max: 199.99,   percentual: 14, fixo: 20, subsidioPix: 5 },
  { min: 200, max: 499.99,   percentual: 14, fixo: 26, subsidioPix: 5 },
  { min: 500, max: Infinity, percentual: 14, fixo: 26, subsidioPix: 8 },
]

function faixaPara(preco: number): FaixaComissao {
  return FAIXAS_COMISSAO_SHOPEE.find(f => preco >= f.min && preco <= f.max) ?? FAIXAS_COMISSAO_SHOPEE[FAIXAS_COMISSAO_SHOPEE.length - 1]
}

export function calcularComissao(precoVenda: number, considerarPix: boolean) {
  const faixa = faixaPara(precoVenda)
  const comissao = (faixa.percentual / 100) * precoVenda + faixa.fixo
  const subsidioPix = considerarPix ? (faixa.subsidioPix / 100) * precoVenda : 0
  return { comissao, subsidioPix, total: comissao + subsidioPix, faixa }
}

// Calcula o preço de venda necessário pra garantir `margemPct`% de margem
// líquida sobre o custo, já descontando a comissão da Shopee (e o subsídio
// Pix, se `considerarPix`). A faixa de comissão depende do próprio preço —
// por isso testa cada faixa e usa a primeira cujo resultado realmente cai
// dentro dela.
export function calcularPrecoParaMargem(custo: number, margemPct: number, considerarPix: boolean): number {
  const alvo = custo * (1 + margemPct / 100)
  for (const faixa of FAIXAS_COMISSAO_SHOPEE) {
    const taxaTotal = faixa.percentual / 100 + (considerarPix ? faixa.subsidioPix / 100 : 0)
    const preco = (alvo + faixa.fixo) / (1 - taxaTotal)
    if (preco >= faixa.min && preco <= faixa.max) return parseFloat(preco.toFixed(2))
  }
  const ultima = FAIXAS_COMISSAO_SHOPEE[FAIXAS_COMISSAO_SHOPEE.length - 1]
  const taxaTotal = ultima.percentual / 100 + (considerarPix ? ultima.subsidioPix / 100 : 0)
  return parseFloat(((alvo + ultima.fixo) / (1 - taxaTotal)).toFixed(2))
}
