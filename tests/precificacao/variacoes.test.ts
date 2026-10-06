import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { anuncioDaVariacao, chaveDoItem, nomeDaVariacao, precificaPorVariacao } from '../../src/lib/precificacao/variacoes'

// Preço por variação: na TikTok, cada variação é uma linha da precificação,
// com o preço dela e o custo do produto dela.
describe('precificação por variação', () => {
  test('só TikTok com variação é precificada por variação', () => {
    assert.equal(precificaPorVariacao('tiktok', true), true)
    assert.equal(precificaPorVariacao('tiktok', false), false)
    assert.equal(precificaPorVariacao('shopee', true), false)
    assert.equal(precificaPorVariacao('mercadolivre', true), false)
  })

  test('linhas de variação do mesmo anúncio não colidem', () => {
    assert.equal(chaveDoItem('a1'), 'a1')
    assert.notEqual(chaveDoItem('a1', 'v1'), chaveDoItem('a1', 'v2'))
  })

  test('o anúncio da variação leva o preço dela e deixa a promoção local para trás', () => {
    const a = { id: 'a1', canal_id: 'c', preco_venda: 21.89, preco_promocional: 19.9, promo_inicio: '2026-10-01', promo_fim: '2026-10-30', tem_variacao: true }
    const v = anuncioDaVariacao(a, { preco: '38.90' })
    assert.equal(v.id, 'a1')
    assert.equal(v.preco_venda, 38.9)
    assert.equal(v.preco_promocional, null)
    assert.equal(v.promo_inicio, null)
    assert.equal(v.tem_variacao, false)
    assert.equal(a.preco_venda, 21.89, 'não altera o anúncio original')
  })

  test('nome da variação cai para o SKU quando não há nome', () => {
    assert.equal(nomeDaVariacao({ nome_variacao: 'Azul', sku_variacao: 'X1', model_id: '9' }), 'Azul')
    assert.equal(nomeDaVariacao({ nome_variacao: ' ', sku_variacao: 'X1', model_id: '9' }), 'SKU X1')
    assert.equal(nomeDaVariacao({ nome_variacao: null, sku_variacao: null, model_id: '9' }), 'SKU 9')
  })
})
