import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ITENS_ORCAMENTO, normalizarItens, validadeAceita, validadePadrao } from '../../src/lib/whatsapp/orcamento'

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'

describe('orçamento pela conversa', () => {
  test('itens: só produto e quantidade; junta repetidos; 3 casas', () => {
    assert.deepEqual(normalizarItens([{ produtoId: A, quantidade: 2 }, { produtoId: B, quantidade: 1.23456 }, { produtoId: A, quantidade: '1' }]),
      [{ produtoId: A, quantidade: 3 }, { produtoId: B, quantidade: 1.235 }])
    // Preço vindo do navegador é ignorado (nem existe no resultado).
    assert.deepEqual(normalizarItens([{ produtoId: A, quantidade: 1, preco: 0.01 }]), [{ produtoId: A, quantidade: 1 }])
  })
  test('itens inválidos recusam o pedido inteiro', () => {
    assert.equal(normalizarItens([]), null)
    assert.equal(normalizarItens('x'), null)
    assert.equal(normalizarItens([{ produtoId: 'abc', quantidade: 1 }]), null)
    assert.equal(normalizarItens([{ produtoId: A, quantidade: 0 }]), null)
    assert.equal(normalizarItens([{ produtoId: A, quantidade: -1 }]), null)
    assert.equal(normalizarItens([{ produtoId: A, quantidade: 'NaN' }]), null)
    assert.equal(normalizarItens([{ produtoId: A, quantidade: 200000 }]), null)
    assert.equal(normalizarItens(Array.from({ length: MAX_ITENS_ORCAMENTO + 1 }, () => ({ produtoId: A, quantidade: 1 }))), null)
  })
  test('validade: padrão 7 dias no dia da loja; fora do intervalo cai no padrão', () => {
    const quinta = new Date('2026-10-16T02:50:00Z') // 15/10 23h50 em São Paulo
    assert.equal(validadePadrao(quinta), '2026-10-22')
    assert.equal(validadeAceita('2026-10-30', quinta), '2026-10-30')
    assert.equal(validadeAceita('2026-10-15', quinta), '2026-10-15')
    assert.equal(validadeAceita('2026-10-14', quinta), '2026-10-22')
    assert.equal(validadeAceita('2028-01-01', quinta), '2026-10-22')
    assert.equal(validadeAceita('30/10/2026', quinta), '2026-10-22')
    assert.equal(validadeAceita(undefined, quinta), '2026-10-22')
  })
})
