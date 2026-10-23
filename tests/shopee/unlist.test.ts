import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { motivoShopeeEmPortugues } from '../../src/lib/shopee/write'

// Motivos reais de recusa da Shopee (20 e 22/10/2026), em português.
describe('motivo da Shopee em português', () => {
  test('GTIN e medidas apontam o que fazer', () => {
    assert.match(motivoShopeeEmPortugues('The GTIN code is mandatory, please check and upload again.'), /GTIN na Shopee/)
    assert.match(motivoShopeeEmPortugues('Parcel size is required. Please fill in it.'), /medidas da embalagem/)
  })
  test('motivo desconhecido passa como veio', () => {
    assert.equal(motivoShopeeEmPortugues('Item is under review'), 'Item is under review')
  })
})
