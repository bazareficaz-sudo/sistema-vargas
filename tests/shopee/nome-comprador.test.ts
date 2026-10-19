import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { nomeDoComprador } from '../../src/lib/shopee/orders'

// A Shopee mascara o destinatário em todo pedido (19/10/2026: 315 de 315);
// o usuário dela vem aberto e vira "@usuario" na lista.
describe('nome do comprador Shopee', () => {
  test('nome mascarado: usa o usuário da Shopee', () => {
    assert.equal(nomeDoComprador({ recipient_address: { name: '****' }, buyer_username: 'maria123' }), '@maria123')
  })
  test('nome aberto (se um dia vier): usa o nome', () => {
    assert.equal(nomeDoComprador({ recipient_address: { name: 'Maria Silva' }, buyer_username: 'maria123' }), 'Maria Silva')
  })
  test('sem nada aberto: fica o que veio', () => {
    assert.equal(nomeDoComprador({ recipient_address: { name: '****' }, buyer_username: '****' }), '****')
    assert.equal(nomeDoComprador({}), null)
  })
})
