import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { conteudoDaTiktok } from '../../src/lib/marketplace/conteudoAnuncio'

// Replicar um anúncio TikTok noutra loja TikTok: categoria, marca e
// atributos são da plataforma e precisam sair do detalhe do produto prontos
// para o formulário.
describe('conteudoDaTiktok', () => {
  test('lê categoria-folha, marca, atributos, peso e medidas do detalhe', () => {
    const c = conteudoDaTiktok({
      description: '<p>Torneira</p>',
      category_chains: [
        { id: '1', parent_id: '0', local_name: 'Casa', is_leaf: false },
        { id: '22', parent_id: '1', local_name: 'Torneiras', is_leaf: true },
      ],
      brand: { id: '7001', name: 'Docol' },
      product_attributes: [
        { id: '100', name: 'Material', values: [{ id: '5', name: 'Metal' }] },
        { id: '101', name: 'Modelo', values: [{ name: 'Gourmet' }] },
        { id: '102', name: 'Vazio', values: [] },
      ],
      package_weight: { value: '450', unit: 'GRAM' },
      package_dimensions: { length: '30', width: '20', height: '10', unit: 'CENTIMETER' },
    })
    assert.equal(c.categoryId, '22')
    assert.equal(c.categoriaCaminho, 'Casa > Torneiras')
    assert.deepEqual(c.marca, { id: '7001', nome: 'Docol' })
    assert.deepEqual(c.atributos, [
      { id: '100', valorId: '5', valorTexto: 'Metal' },
      { id: '101', valorId: null, valorTexto: 'Gourmet' },
    ])
    assert.equal(c.pesoKg, 0.45)
    assert.equal(c.comprimentoCm, 30)
    assert.equal(c.descricao, '<p>Torneira</p>')
  })

  test('produto só da busca do catálogo (sem detalhe) não quebra', () => {
    const c = conteudoDaTiktok({ id: '9', title: 'X' })
    assert.equal(c.categoryId, null)
    assert.equal(c.marca, null)
    assert.deepEqual(c.atributos, [])
    assert.equal(c.pesoKg, null)
  })
})
