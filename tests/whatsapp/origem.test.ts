import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { codigoDeOrigem } from '../../src/lib/whatsapp/origem'

describe('origem do contato', () => {
  test('acha o código do link do post e o digitado pelo cliente', () => {
    assert.equal(codigoDeOrigem('Olá! Vi a publicação de vocês (código T7K2) e quero saber mais.'), 'T7K2')
    assert.equal(codigoDeOrigem('vi no insta, código t7k2'), 'T7K2')
    assert.equal(codigoDeOrigem('T7K2'), 'T7K2')
    assert.equal(codigoDeOrigem('[foto] quero esse A2B3!'), 'A2B3')
  })
  test('não confunde com outras coisas', () => {
    assert.equal(codigoDeOrigem('oi, tem cimento?'), null)
    assert.equal(codigoDeOrigem('cabo 2,5mm e disjuntor 32A'), null)
    assert.equal(codigoDeOrigem('código TOK1'), null)          // O e 1 não existem no formato
    assert.equal(codigoDeOrigem('pedido XT7K2'), null)         // grudado em outra letra
    assert.equal(codigoDeOrigem('T7K23'), null)                // grudado em número
    assert.equal(codigoDeOrigem(''), null)
    assert.equal(codigoDeOrigem(null), null)
  })
})
