import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidirSimulacao } from '../../src/lib/marketplace/simulacao'

// Pedido em 03/09/2026: testar envio real em UM canal (Shp Ouro) mantendo os
// outros em simulação. Antes, `simulacao` era só da empresa e ligava tudo de
// uma vez.

describe('o canal manda quando escolheu', () => {
  test('canal com false ENVIA mesmo com a empresa em simulação', () => {
    // É o caso do teste: empresa simulando, Shp Ouro enviando de verdade.
    const d = decidirSimulacao({ fila_simulacao: false }, { simulacaoDaEmpresa: true })
    assert.equal(d.simula, false)
    assert.equal(d.origem, 'canal')
    assert.match(d.explicacao, /ENVIA de verdade/)
  })

  test('canal com true SIMULA mesmo com a empresa enviando', () => {
    const d = decidirSimulacao({ fila_simulacao: true }, { simulacaoDaEmpresa: false })
    assert.equal(d.simula, true)
    assert.equal(d.origem, 'canal')
  })
})

describe('nulo herda da empresa', () => {
  test('sem escolha no canal, segue a empresa', () => {
    assert.equal(decidirSimulacao({ fila_simulacao: null }, { simulacaoDaEmpresa: true }).simula, true)
    assert.equal(decidirSimulacao({ fila_simulacao: null }, { simulacaoDaEmpresa: false }).simula, false)
    assert.equal(decidirSimulacao({}, { simulacaoDaEmpresa: true }).origem, 'empresa')
    assert.equal(decidirSimulacao(null, { simulacaoDaEmpresa: true }).origem, 'empresa')
  })
})

describe('false do canal NÃO é ausência', () => {
  test('a distinção que um `??` apagaria', () => {
    // `canal.fila_simulacao ?? empresa` trataria false como ausente, e o
    // canal nunca sairia de simulação — exatamente o recurso pedido.
    const d = decidirSimulacao({ fila_simulacao: false }, { simulacaoDaEmpresa: true })
    assert.equal(d.simula, false, 'false no canal precisa vencer o true da empresa')
  })
})
