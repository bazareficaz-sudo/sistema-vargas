import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarTelefone, mesmoTelefone, telefoneBuscavel, formatarTelefone } from '../../src/lib/clientes/telefone'

// Achar o cliente pelo telefone na entrega do PDV. O cadastro guarda só
// dígitos; o balconista digita de qualquer jeito.

describe('telefone de cliente', () => {
  test('qualquer formato vira só dígitos, sem 55 e sem 0 de discagem', () => {
    assert.equal(normalizarTelefone('(21) 99120-3602'), '21991203602')
    assert.equal(normalizarTelefone('+55 21 99120 3602'), '21991203602')
    assert.equal(normalizarTelefone('021991203602'), '21991203602')
  })

  test('mesmo número em formatos diferentes, e sem DDD de um lado', () => {
    assert.equal(mesmoTelefone('21991203602', '(21) 99120-3602'), true)
    assert.equal(mesmoTelefone('21991203602', '99120-3602'), true)
    assert.equal(mesmoTelefone('5521991203602', '21 991203602'), true)
  })

  test('números diferentes, ou curtos demais, não casam', () => {
    assert.equal(mesmoTelefone('21991203602', '21991203603'), false)
    assert.equal(mesmoTelefone('21991203602', '3602'), false)
    assert.equal(mesmoTelefone(null, '21991203602'), false)
  })

  test('só procura com pelo menos 8 dígitos', () => {
    assert.equal(telefoneBuscavel('9912-3602'), true)
    assert.equal(telefoneBuscavel('3602'), false)
  })

  test('formatação para a tela', () => {
    assert.equal(formatarTelefone('21991203602'), '(21) 99120-3602')
    assert.equal(formatarTelefone('2133334444'), '(21) 3333-4444')
  })
})
