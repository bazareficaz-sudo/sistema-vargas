import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarParaCampanha, resumirVeredito } from '../../src/lib/marketplace/travaCampanha'
import type { Cenario } from '../../src/lib/precificacao/cenarios'

// Preço promocional é preço NO AR, com prazo. A "Bota Fora" vai até 31/10 —
// um item que entra com margem negativa vende no prejuízo por dois meses
// antes de alguém somar.

const cenario = (margemLiquida: number, lucro: number): Cenario => ({
  rotulo: 'promocional',
  resultado: { margemLiquida, lucro } as Cenario['resultado'],
  saude: 'saudavel', lucroSobreCusto: 0, valido: true,
})

describe('bloqueio: o sistema não deixa passar de jeito nenhum', () => {
  test('sem economia calculável — o pior dos casos', () => {
    // A tela mostra "não calculável" e segue; aqui não. Enviar sem saber a
    // margem é apostar pelo prazo inteiro da campanha.
    const v = avaliarParaCampanha({ precoPromocional: 20, cenario: null })
    assert.equal(v.bloqueado, true)
    assert.equal(v.motivo, 'sem_economia')
    assert.match(v.explicacao ?? '', /até o fim da campanha/)
  })

  test('preço zero ou negativo', () => {
    assert.equal(avaliarParaCampanha({ precoPromocional: 0, cenario: cenario(10, 1) }).bloqueado, true)
    assert.equal(avaliarParaCampanha({ precoPromocional: -5, cenario: cenario(10, 1) }).bloqueado, true)
  })

  test('promoção que SOBE o preço', () => {
    // Quase sempre engano de digitação, e a Shopee aceitaria — ela não sabe
    // qual é o seu preço normal.
    const v = avaliarParaCampanha({ precoPromocional: 50, precoNormal: 44.9, cenario: cenario(20, 5) })
    assert.equal(v.bloqueado, true)
    assert.equal(v.motivo, 'acima_do_normal')
  })
})

describe('confirmação: decisão comercial legítima, mas explícita', () => {
  test('prejuízo passa COM confirmação, e a frase diz quanto', () => {
    // Queima de estoque parado é decisão de negócio válida. O que não pode é
    // acontecer sem alguém saber o número.
    const v = avaliarParaCampanha({ precoPromocional: 29.63, cenario: cenario(-31, -9.17) })
    assert.equal(v.bloqueado, false)
    assert.equal(v.liberado, false)
    assert.equal(v.motivo, 'prejuizo')
    assert.match(v.explicacao ?? '', /PREJUÍZO/)
    assert.match(v.explicacao ?? '', /9,17/)
  })

  test('abaixo do piso da regra pede confirmação', () => {
    const v = avaliarParaCampanha({ precoPromocional: 30, cenario: cenario(8, 2.4), pisoMargem: 12 })
    assert.equal(v.motivo, 'abaixo_do_piso')
    assert.match(v.explicacao ?? '', /8,0%|8.0%/)
    assert.match(v.explicacao ?? '', /12%/)
  })
})

describe('liberado', () => {
  test('acima do piso passa direto', () => {
    const v = avaliarParaCampanha({ precoPromocional: 30, cenario: cenario(18, 5.4), pisoMargem: 12 })
    assert.equal(v.liberado, true)
    assert.equal(v.bloqueado, false)
  })

  test('sem piso configurado, basta não dar prejuízo', () => {
    const v = avaliarParaCampanha({ precoPromocional: 30, cenario: cenario(2, 0.6) })
    assert.equal(v.liberado, true)
  })

  test('margem exatamente no piso passa', () => {
    const v = avaliarParaCampanha({ precoPromocional: 30, cenario: cenario(12, 3.6), pisoMargem: 12 })
    assert.equal(v.liberado, true)
  })
})

describe('resumo do lote', () => {
  test('separa os três grupos, que pedem ações diferentes', () => {
    const r = resumirVeredito([
      avaliarParaCampanha({ precoPromocional: 30, cenario: cenario(18, 5) }),
      avaliarParaCampanha({ precoPromocional: 30, cenario: cenario(-5, -1) }),
      avaliarParaCampanha({ precoPromocional: 30, cenario: null }),
    ])
    assert.deepEqual(r, { liberados: 1, exigemConfirmacao: 1, bloqueados: 1 })
  })
})
