import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { conferencia, deveConferir } from '../../src/lib/marketplace/conferirEstoque'

// Depois de um reenvio, a leitura na plataforma decide se o ciclo fecha.
describe('conferencia', () => {
  test('leitura igual ao enviado confirma', () => {
    const c = conferencia(4, 4)
    assert.equal(c.confirmado, true)
    assert.match(c.detalhe, /conferido na plataforma: 4/)
  })

  test('leitura diferente é envio aceito e não aplicado', () => {
    const c = conferencia(4, 6)
    assert.equal(c.confirmado, false)
    assert.match(c.detalhe, /aceitou o envio de 4/)
    assert.match(c.detalhe, /ainda mostra 6/)
  })
})

describe('quando conferir', () => {
  test('reenvio e envio que zera o anúncio conferem; envio comum não', () => {
    assert.equal(deveConferir({ espelhoDivergente: true, estoqueNovo: 5, plataforma: 'shopee' }), true)
    assert.equal(deveConferir({ espelhoDivergente: false, estoqueNovo: 0, plataforma: 'shopee' }), true)
    assert.equal(deveConferir({ espelhoDivergente: false, estoqueNovo: 5, plataforma: 'shopee' }), false)
    assert.equal(deveConferir({ espelhoDivergente: false, estoqueNovo: undefined, plataforma: 'shopee' }), false)
    assert.equal(deveConferir({ espelhoDivergente: true, estoqueNovo: 0, plataforma: 'nuvemshop' }), false)
  })
  test('Shopee aceita e não aplica: a mensagem aponta GTIN e medidas', () => {
    // Caso real de 20/10/2026: torneiras Acquabios, 0 enviado, 1000 lido.
    const c = conferencia(0, 1000, 'shopee')
    assert.equal(c.confirmado, false)
    assert.match(c.detalhe, /GTIN \(EAN\) e medidas/)
  })
})
