import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { paraNumeroBr, formatarNumeroBr, paraEdicaoBr } from '../../src/lib/entradas/numeroBr'

describe('leitura de número no formato brasileiro', () => {
  test('O DEFEITO RELATADO: 118,30 tem de valer 118,3', () => {
    assert.equal(paraNumeroBr('118,30'), 118.3)
    assert.equal(paraNumeroBr('118,3'), 118.3)
  })

  test('vírgula solta no fim não vira número inteiro nem NaN', () => {
    // Era isto que apagava a vírgula a cada tecla no campo controlado.
    assert.equal(paraNumeroBr('118,'), 118)
    assert.equal(paraNumeroBr(','), 0)
  })

  test('O ERRO CARO: 1.234,50 não pode virar 1,23', () => {
    // parseFloat('1.234,50'.replace(',', '.')) === 1.234
    assert.equal(paraNumeroBr('1.234,50'), 1234.5)
    assert.equal(paraNumeroBr('12.345,67'), 12345.67)
    assert.equal(paraNumeroBr('1.234.567,89'), 1234567.89)
  })

  test('ponto único separando três dígitos é milhar, como se lê em português', () => {
    assert.equal(paraNumeroBr('1.234'), 1234)
    assert.equal(paraNumeroBr('12.500'), 12500)
    assert.equal(paraNumeroBr('1.234.567'), 1234567)
  })

  test('ponto decimal digitado no teclado numérico continua valendo', () => {
    assert.equal(paraNumeroBr('118.30'), 118.3)
    assert.equal(paraNumeroBr('1.5'), 1.5)
    assert.equal(paraNumeroBr('0.75'), 0.75)
  })

  test('número puro, sem pontuação', () => {
    assert.equal(paraNumeroBr('118'), 118)
    assert.equal(paraNumeroBr('0'), 0)
    assert.equal(paraNumeroBr(1234.5), 1234.5)
  })

  test('lixo em volta é ignorado — R$, espaço, texto colado', () => {
    assert.equal(paraNumeroBr('R$ 118,30'), 118.3)
    assert.equal(paraNumeroBr(' 1.234,50 '), 1234.5)
    assert.equal(paraNumeroBr('abc'), 0)
    assert.equal(paraNumeroBr(''), 0)
    assert.equal(paraNumeroBr(null), 0)
    assert.equal(paraNumeroBr(undefined), 0)
  })

  test('negativo é preservado', () => {
    assert.equal(paraNumeroBr('-118,30'), -118.3)
    assert.equal(paraNumeroBr('-1.234,50'), -1234.5)
  })

  test('ida e volta: o que a tela mostra, a tela consegue ler de novo', () => {
    for (const v of [0, 1, 1.5, 118.3, 1234.5, 12345.67, 1234567.89, -42.75]) {
      assert.equal(paraNumeroBr(formatarNumeroBr(v)), v, `formatado: ${formatarNumeroBr(v)}`)
      assert.equal(paraNumeroBr(paraEdicaoBr(v)), v, `edição: ${paraEdicaoBr(v)}`)
    }
  })

  test('o texto de edição não traz separador de milhar', () => {
    assert.equal(paraEdicaoBr(1234.5), '1234,50')
    assert.equal(formatarNumeroBr(1234.5), '1.234,50')
  })
})
