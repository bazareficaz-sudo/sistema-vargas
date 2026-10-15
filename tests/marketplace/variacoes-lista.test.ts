import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resumoDasVariacoes, temDivergencia } from '../../src/components/marketplaces/utils'

// Anúncio com variação: preço e estoque vêm das variações, não do anúncio
// (que a Shopee deixa zerado). Caso real: "Torneira 2 Saídas", 15/10/2026.
describe('listagem de anúncio com variações', () => {
  const torneira = {
    tem_variacao: true, preco_venda: 0, estoque_externo: null, produto_id: 'p1',
    produtos: { preco_venda: 54, estoque: 0 },
    marketplace_anuncio_variacoes: [{ produto_id: 'p1', preco: 49.89, estoque: 99, produtos: { preco_venda: 49.89, estoque: 99 } }],
  }
  test('preço e estoque saem das variações', () => {
    assert.deepEqual(resumoDasVariacoes(torneira), { precoMin: 49.89, precoMax: 49.89, estoque: 99 })
    const duas = { ...torneira, marketplace_anuncio_variacoes: [{ preco: 10, estoque: 2 }, { preco: 15, estoque: 3 }] }
    assert.deepEqual(resumoDasVariacoes(duas), { precoMin: 10, precoMax: 15, estoque: 5 })
  })
  test('anúncio sem variação segue pelo próprio anúncio', () => {
    assert.equal(resumoDasVariacoes({ tem_variacao: false, preco_venda: 20 }), null)
  })
  test('divergência compara cada variação com o produto dela, não o anúncio zerado', () => {
    assert.equal(temDivergencia(torneira), false)
    const estoqueDiferente = { ...torneira, marketplace_anuncio_variacoes: [{ produto_id: 'p1', preco: 49.89, estoque: 99, produtos: { preco_venda: 49.89, estoque: 0 } }] }
    assert.equal(temDivergencia(estoqueDiferente), true)
  })
})
