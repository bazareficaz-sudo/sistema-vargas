import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { explicarRegraEstoque } from '../../src/lib/marketplace/regraEstoque'

// A pergunta que originou isto, em 03/09/2026:
//
//   "um produto tem 10 em estoque; com complemento 1000 e risco 1000, o
//    sistema envia 1010 e pausa quando o estoque chegar a 1000?"
//
// Envia 1010, sim. Pausa aos 1000, não — pausa quando o estoque REAL chegar
// a zero. Em `aplicarRegra.ts` o risco é comparado contra o valor já somado
// ao complemento, e a tela não dizia isso.

describe('o caso perguntado', () => {
  test('complemento 1000 + risco 1000: envia 1010, pausa com saldo 0', () => {
    const r = explicarRegraEstoque({ complementar: 1000, risco: 1000, saldoExemplo: 10 })
    assert.equal(r.envia, 1010)
    assert.equal(r.pausaComSaldoReal, 0)
    assert.equal(r.nuncaPausa, false)
    assert.match(r.frase, /estoque REAL chegar a 0/)
  })
})

describe('o engano que morde de verdade', () => {
  test('complemento 1000 + risco 5: NUNCA pausa, e a frase avisa', () => {
    // Alguém configura pensando "pausa quando sobrar 5". A conta vira
    // `saldo + 1000 <= 5`, ou seja, saldo <= -995.
    const r = explicarRegraEstoque({ complementar: 1000, risco: 5 })
    assert.equal(r.nuncaPausa, true)
    assert.equal(r.pausaComSaldoReal, -995)
    assert.match(r.frase, /NUNCA pausa/)
    assert.match(r.frase, /já somado ao complemento/)
  })

  test('limiar exatamente zero não é "nunca pausa"', () => {
    // Fronteira: pausar com saldo zero é o comportamento desejado, e não
    // pode ser confundido com a armadilha.
    const r = explicarRegraEstoque({ complementar: 100, risco: 100 })
    assert.equal(r.nuncaPausa, false)
    assert.equal(r.pausaComSaldoReal, 0)
  })
})

describe('sem complemento, o número é o que parece', () => {
  test('risco 5 sem complemento pausa aos 5 mesmo', () => {
    const r = explicarRegraEstoque({ complementar: 0, risco: 5, saldoExemplo: 10 })
    assert.equal(r.envia, 10)
    assert.equal(r.pausaComSaldoReal, 5)
    // Sem complemento não há o que explicar sobre a ordem das contas.
    assert.doesNotMatch(r.frase, /somado ao complemento/)
  })
})

describe('sem risco configurado', () => {
  test('não pausa, e diz isso', () => {
    const r = explicarRegraEstoque({ complementar: 1000, risco: null, saldoExemplo: 10 })
    assert.equal(r.pausaComSaldoReal, null)
    assert.equal(r.envia, 1010)
    assert.match(r.frase, /não pausa sozinho/)
  })

  test('campo vazio conta como ausente, não como zero', () => {
    // Risco 0 e risco vazio são coisas diferentes: 0 pausa quando zera, e
    // vazio nunca pausa.
    const vazio = explicarRegraEstoque({ complementar: 0, risco: '' })
    assert.equal(vazio.pausaComSaldoReal, null)
    const zero = explicarRegraEstoque({ complementar: 0, risco: 0 })
    assert.equal(zero.pausaComSaldoReal, 0)
  })
})

describe('entradas estranhas não quebram', () => {
  test('tudo ausente', () => {
    const r = explicarRegraEstoque({})
    assert.equal(r.envia, 10)
    assert.equal(r.pausaComSaldoReal, null)
  })

  test('complemento negativo — reserva de segurança', () => {
    // Complemento negativo é legítimo: guardar unidades fora do canal.
    const r = explicarRegraEstoque({ complementar: -3, risco: 0, saldoExemplo: 10 })
    assert.equal(r.envia, 7)
    assert.equal(r.pausaComSaldoReal, 3, 'pausa quando o saldo real chegar a 3')
  })
})
