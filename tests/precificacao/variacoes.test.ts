import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { anuncioDaVariacao, chaveDoItem, nomeDaVariacao, precificaPorVariacao, precoUnicoNasVariacoes, produtoDoPrecoUnico } from '../../src/lib/precificacao/variacoes'

// Preço por variação: na TikTok e na Shopee, cada variação é uma linha da precificação,
// com o preço dela e o custo do produto dela.
describe('precificação por variação', () => {
  test('TikTok e Shopee com variação são precificadas por variação; ML não', () => {
    assert.equal(precificaPorVariacao('tiktok', true), true)
    assert.equal(precificaPorVariacao('tiktok', false), false)
    assert.equal(precificaPorVariacao('shopee', true), true)
    assert.equal(precificaPorVariacao('shopee', false), false)
    assert.equal(precificaPorVariacao('mercadolivre', true), false)
  })

  test('ML com variação tem preço único para todas', () => {
    assert.equal(precoUnicoNasVariacoes('mercadolivre', true), true)
    assert.equal(precoUnicoNasVariacoes('mercadolivre', false), false)
    assert.equal(precoUnicoNasVariacoes('shopee', true), false)
  })

  test('preço único sai do produto de MAIOR custo entre as variações', async () => {
    const custos: Record<string, number> = { a: 10, b: 25, c: 18 }
    const custoDe = async (p: { id: string }) => custos[p.id] ?? 0
    const r = await produtoDoPrecoUnico(
      [{ produtos: { id: 'a', nome: 'P' } }, { produtos: { id: 'b', nome: 'G' } }, { produtos: { id: 'c', nome: 'M' } }],
      { id: 'a', nome: 'P' }, custoDe,
    )
    assert.equal(r.produto?.id, 'b')
    assert.match(r.aviso ?? '', /3 variações.*maior custo \(G\)/)
  })

  test('preço único: variações sem produto ficam com o produto do anúncio', async () => {
    const r = await produtoDoPrecoUnico([{ produtos: null }, { produtos: null }], { id: 'x', nome: 'X' }, async () => 5)
    assert.equal(r.produto?.id, 'x')
    assert.equal(r.aviso, 'Mercado Livre: o mesmo preço vale para as 2 variações')
    const vazio = await produtoDoPrecoUnico([], null, async () => 5)
    assert.equal(vazio.produto, null)
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
