import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { avaliar, faltasGerais, marcaNoNome, type ProdutoProntidao } from '../../src/lib/anuncios/prontidao'

const prod = (o: Partial<ProdutoProntidao> = {}): ProdutoProntidao => ({
  id: 'p', nome: 'GUEPAR DISJUNTOR MONOPOLAR - 32A', sku: '1887', ean: null, marca: 'GUEPAR',
  estoque: 19, preco_venda: 11, preco_custo: 5, peso_kg: null, comprimento_cm: null, largura_cm: null, altura_cm: null,
  descricao_marketplace: null, fotos: 0, plataformas: [], ...o,
})

describe('prontidão por canal', () => {
  test('sem foto, peso e medidas não está pronto em lugar nenhum', () => {
    assert.deepEqual(avaliar(prod(), 'mercadolivre').faltaObrigatorio, ['foto', 'peso', 'medidas'])
    assert.equal(avaliar(prod(), 'tiktok').pronto, false)
  })
  test('TikTok não exige medidas; Shopee exige descrição', () => {
    const p = prod({ fotos: 2, peso_kg: 0.1, descricao_marketplace: 'Disjuntor monopolar de 32A para proteção de circuitos residenciais em quadro DIN.' })
    assert.equal(avaliar(p, 'tiktok').pronto, true)
    assert.deepEqual(avaliar(p, 'shopee').faltaObrigatorio, ['medidas'])
    assert.ok(avaliar(p, 'tiktok').faltaRecomendado.includes('medidas'))
  })
  test('descrição curta não conta', () => {
    assert.ok(faltasGerais(prod({ descricao_marketplace: 'Disjuntor 32A' })).includes('descricao'))
  })
  test('já anunciado aparece como tal', () => {
    assert.equal(avaliar(prod({ plataformas: ['shopee'] }), 'shopee').jaAnunciado, true)
  })
})

describe('marca pelo nome', () => {
  test('acha a marca cadastrada no nome, a mais específica primeiro', () => {
    assert.equal(marcaNoNome('GUEPAR DISJUNTOR MONOPOLAR - 32A', ['GUEPAR', 'STECK']), 'GUEPAR')
    assert.equal(marcaNoNome('Faca Tramontina Pro 8"', ['TRAMONTINA', 'TRAMONTINA PRO']), 'TRAMONTINA PRO')
    assert.equal(marcaNoNome('DISJUNTOR DIN BIPOLAR 32A', ['GUEPAR']), null)
  })
  test('não casa pedaço de palavra', () => {
    assert.equal(marcaNoNome('ROLDANA GE 50MM', ['GE']), 'GE')
    assert.equal(marcaNoNome('ENGATE RAPIDO', ['GE']), null)
  })
})
