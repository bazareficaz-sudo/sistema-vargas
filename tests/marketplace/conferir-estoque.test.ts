import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { conferencia } from '../../src/lib/marketplace/conferirEstoque'

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
