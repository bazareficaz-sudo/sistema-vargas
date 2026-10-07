import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { anuncioIndicadoNoLink, conferirAnuncioDoCatalogo, extrairItemId } from '../../src/lib/mercadolivre/item'

// Link de CATÁLOGO passou a ser importado (07/10/2026). O anúncio que o link
// indica (`wid`) só vale conferido contra o catálogo do caminho — sem isso
// voltaria o defeito da tela mosquiteira (url-ml.test.ts): importar um
// anúncio diferente do que a pessoa abriu.

const UP_DA_BUSCA =
  'https://www.mercadolivre.com.br/kit-10-trena-1m-chaveiro/up/MLBU3498162062'
  + '#polycard_client=search-desktop&be_origin=backend&wid=MLB5512345678&sid=search'

describe('anúncio indicado num link de catálogo', () => {
  test('lê o wid do fragmento', () => {
    assert.equal(anuncioIndicadoNoLink(UP_DA_BUSCA), 'MLB5512345678')
  })

  test('lê item_id dos filtros da página de catálogo', () => {
    const u = 'https://www.mercadolivre.com.br/furadeira/p/MLB12345678?pdp_filters=item_id%3AMLB4400011122'
    assert.equal(anuncioIndicadoNoLink(u), 'MLB4400011122')
  })

  test('link sem anúncio indicado devolve null', () => {
    assert.equal(anuncioIndicadoNoLink('https://www.mercadolivre.com.br/x/up/MLBU3498162062'), null)
  })

  test('continua NÃO sendo o id do anúncio do link — só uma indicação', () => {
    assert.equal(extrairItemId(UP_DA_BUSCA), null)
  })
})

describe('conferir o anúncio indicado contra o catálogo', () => {
  test('/up/: vale só se o anúncio for daquele produto do vendedor', () => {
    assert.equal(conferirAnuncioDoCatalogo({ user_product_id: 'MLBU3498162062' }, 'MLBU3498162062'), true)
    assert.equal(conferirAnuncioDoCatalogo({ user_product_id: 'MLBU999' }, 'MLBU3498162062'), false)
    assert.equal(conferirAnuncioDoCatalogo({}, 'MLBU3498162062'), false)
  })

  test('/p/: vale só se o anúncio estiver naquele produto do catálogo', () => {
    assert.equal(conferirAnuncioDoCatalogo({ catalog_product_id: 'MLB12345678' }, 'MLB12345678'), true)
    assert.equal(conferirAnuncioDoCatalogo({ catalog_product_id: 'MLB87654321' }, 'MLB12345678'), false)
    // Anúncio fora do catálogo, mesmo do produto do vendedor, não serve para /p/.
    assert.equal(conferirAnuncioDoCatalogo({ user_product_id: 'MLB12345678' }, 'MLB12345678'), false)
  })
})
