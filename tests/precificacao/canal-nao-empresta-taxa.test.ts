import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcular } from '../../src/lib/precificacao/motor'
import type { ConfigTaxas, FaixaFrete } from '../../src/lib/precificacao/tipos'

// UM CANAL NÃO PODE PAGAR A TAXA DE OUTRO.
//
// Reportado em 01/09/2026, da tela de rascunho: "os custos não condizem com os
// custos reais do anúncio". Os quatro canais da empresa devolviam o MESMO
// preço, R$ 13,01, para o mesmo produto — o que já era o sintoma, porque
// Shopee e Mercado Livre não cobram a mesma coisa.
//
// A causa: as quatro regras cadastradas estavam em `shopee_liquido`, inclusive
// as dos dois canais de ML, e a tela de rascunho calculava o preço com
// `src/lib/shopee/aplicarRegra.ts`. O Mercado Livre estava sendo precificado
// com a comissão de 20% e a taxa fixa de R$ 4,00 da Shopee.
//
// Os números abaixo são os REAIS deste sistema, medidos no banco em 01/09:
// o custo do produto, a configuração de cada canal, a comissão do ML medida
// na API em 30/08 (11,5% na categoria MLB271699) e a escada de frete medida
// no mesmo dia — inclusive abaixo de R$ 79, que é onde estava o engano.

const CUSTO = 4.00
const MARGEM_PEDIDA = 20 // % sobre o custo, líquida

/** Configuração real do canal Shopee: comissão por faixa, sem frete. */
const SHOPEE: ConfigTaxas = {
  canalId: null, plataforma: 'shopee', nome: 'Shp Eficaz',
  comissaoModo: 'faixas', comissaoPercentual: 0, comissaoFixo: 0,
  comissaoFaixas: [
    { min: 0, max: 79.99, percentual: 20, fixo: 4 },
    { min: 80, max: 99.99, percentual: 14, fixo: 16 },
    { min: 100, max: null, percentual: 14, fixo: 20 },
  ],
  taxas: [],
  freteModo: 'nao', freteValor: 0, freteLimiteGratis: 0, freteCustoMedio: 0, freteFaixas: [],
  embalagem: { nome: 'Embalagem', tipo: 'fixo', valor: 0.8 },
  imposto: { nome: 'Imposto', tipo: 'percentual', valor: 5, base: 'preco' },
  custosExtras: [], diasRecebimento: 14,
}

/** Configuração real do canal Mercado Livre. */
const ML: ConfigTaxas = {
  canalId: null, plataforma: 'mercadolivre', nome: 'ML Eficaz',
  comissaoModo: 'api_ml', comissaoPercentual: 11.5, comissaoFixo: 0,
  comissaoFaixas: [
    { min: 0, max: 149.99, percentual: 11.5, fixo: 0 },
    { min: 150, max: null, percentual: 10.5, fixo: 0 },
  ],
  taxas: [],
  freteModo: 'gratis_acima', freteValor: 0, freteLimiteGratis: 79, freteCustoMedio: 22, freteFaixas: [],
  freteMlImportar: true,
  embalagem: { nome: 'Embalagem', tipo: 'fixo', valor: 0.8 },
  imposto: { nome: 'Imposto', tipo: 'percentual', valor: 5, base: 'preco' },
  custosExtras: [], diasRecebimento: 14,
}

/**
 * Escada de frete MEDIDA na API do Mercado Livre em 30/08/2026.
 *
 * As duas primeiras faixas são o ponto: abaixo de R$ 79 o vendedor PAGA. A
 * premissa antiga — "abaixo do limite quem paga é o comprador" — era falsa, e
 * é ela que fazia o preço parecer lucrativo.
 */
const FRETE_ML_MEDIDO: FaixaFrete[] = [
  { min: 0, max: 49.99, valor: 6.95 },
  { min: 50, max: 78.99, valor: 8.25 },
  { min: 79, max: 99.99, valor: 13.85 },
  { min: 100, max: null, valor: 16.15 },
]

const perto = (a: number, b: number, tol = 0.02) =>
  assert.ok(Math.abs(a - b) <= tol, `esperava ~${b}, veio ${a} (tolerância ${tol})`)

describe('o preço da Shopee não muda', () => {
  // Regressão. A Shopee já estava certa: a conta antiga
  // (`calcularPrecoParaMargem`) e o motor usam as mesmas faixas e a mesma base
  // de custo. Se este teste quebrar, a troca de motor mexeu em quem estava bom.
  test('margem 20% sobre custo R$ 4,00 continua dando R$ 13,01', () => {
    const r = calcular({
      cfg: SHOPEE, custoProduto: CUSTO,
      objetivo: { tipo: 'sobre_custo', valor: MARGEM_PEDIDA },
    })
    assert.equal(r.preco, 13.01)
    perto(r.lucro, 0.96, 0.03) // 20% de R$ 4,80 (custo + embalagem)
  })
})

describe('o Mercado Livre não paga mais a taxa da Shopee', () => {
  test('a mesma margem, no ML, pede um preço DIFERENTE', () => {
    const r = calcular({
      cfg: ML, custoProduto: CUSTO, freteFaixas: FRETE_ML_MEDIDO,
      objetivo: { tipo: 'sobre_custo', valor: MARGEM_PEDIDA },
    })
    // R$ 15,22: (4,80 × 1,20 + 6,95 de frete) ÷ (1 − 11,5% − 5%)
    perto(r.preco, 15.22, 0.05)
    assert.notEqual(r.preco, 13.01, 'preço do ML não pode ser o preço da Shopee')
  })

  test('o R$ 13,01 da Shopee, vendido no ML, dá PREJUÍZO', () => {
    // Este é o defeito reportado, em forma de teste. O operador via
    // "markup 225,3%" e clicava em usar.
    const r = calcular({
      cfg: ML, custoProduto: CUSTO, freteFaixas: FRETE_ML_MEDIDO,
      objetivo: { tipo: 'preco', valor: 13.01 },
    })
    perto(r.comissao, 1.50, 0.02)
    assert.equal(r.frete, 6.95, 'a faixa medida de R$ 0 a R$ 49,99')
    perto(r.lucro, -0.89, 0.03)
    assert.ok(r.lucro < 0, 'vender a R$ 13,01 no Mercado Livre perde dinheiro')
  })

  test('a taxa fixa de R$ 4,00 é da Shopee e não aparece no ML', () => {
    const naShopee = calcular({ cfg: SHOPEE, custoProduto: CUSTO, objetivo: { tipo: 'preco', valor: 13.01 } })
    const noMl = calcular({ cfg: ML, custoProduto: CUSTO, freteFaixas: FRETE_ML_MEDIDO, objetivo: { tipo: 'preco', valor: 13.01 } })
    // 20% + R$ 4,00 contra 11,5% + R$ 0,00 — a diferença que ninguém via.
    perto(naShopee.comissao, 6.60, 0.02)
    perto(noMl.comissao, 1.50, 0.02)
  })
})

describe('sem medidas do produto, o frete do ML some da conta', () => {
  // NÃO É O COMPORTAMENTO DESEJADO — é o comportamento real, registrado para
  // que ninguém o confunda com verdade.
  //
  // Sem peso e dimensões não há escada medida, e o cálculo cai em
  // `freteModo: 'gratis_acima'`, que devolve ZERO abaixo do limite. A medição
  // de 30/08 mostra R$ 6,95 nessa faixa. Por isso o contexto marca a origem
  // como `api_ml_sem_medidas` e a tela precisa dizer "frete NÃO medido": o
  // número é zero, e zero aqui é um palpite, não um fato.
  test('o preço fica otimista, e é por isso que a origem precisa aparecer', () => {
    const semMedidas = calcular({
      cfg: ML, custoProduto: CUSTO, freteFaixas: null,
      objetivo: { tipo: 'sobre_custo', valor: MARGEM_PEDIDA },
    })
    assert.equal(semMedidas.frete, 0, 'gratis_acima devolve zero abaixo do limite')
    perto(semMedidas.preco, 6.90, 0.05)

    const comMedidas = calcular({
      cfg: ML, custoProduto: CUSTO, freteFaixas: FRETE_ML_MEDIDO,
      objetivo: { tipo: 'sobre_custo', valor: MARGEM_PEDIDA },
    })
    assert.ok(
      comMedidas.preco > semMedidas.preco + 8,
      'medir o frete muda o preço em mais de R$ 8 — a diferença entre lucro e prejuízo',
    )
  })
})
