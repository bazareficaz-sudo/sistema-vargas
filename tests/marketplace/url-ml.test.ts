import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { classificarUrlML, extrairItemId } from '../../src/lib/mercadolivre/item'

// O caso reportado em 01/09/2026: o operador colou o link de um anúncio de
// outro vendedor e recebeu "o Mercado Livre negou a leitura... reconecte a
// conta". O conselho estava errado — o problema não era autorização.
//
//   https://www.mercadolivre.com.br/tela-mosquiteira.../up/MLBU3472391724
//     #polycard_client=search-desktop&be_origin=backend&wid=MLB5099887766
//
// Duas coisas erradas ao mesmo tempo:
//
//   1. `/up/MLBU...` é página de CATÁLOGO, não anúncio de vendedor. A API
//      /items/ não a atende, e não há o que importar dali.
//   2. A extração lia `MLB` de QUALQUER lugar da URL — inclusive do `wid`,
//      que é rastreio da busca. Pegou o id errado e perguntou por ele.
//
// O segundo é o grave, e o que não deu erro é pior que o que deu: se aquele
// id de rastreio fosse legível pela conta, o sistema teria importado um
// anúncio DIFERENTE do que a pessoa abriu, sem nada indicando a troca.

const CATALOGO_REAL =
  'https://www.mercadolivre.com.br/tela-mosquiteira-para-janela-com-velcro-130x150-pernilongo/up/MLBU3472391724'
  + '#polycard_client=search-desktop&be_origin=backend&wid=MLB5099887766&sid=search'

describe('classificar link do ML — o caso da tela mosquiteira', () => {
  test('link de catálogo é reconhecido COMO catálogo, não como anúncio', () => {
    const alvo = classificarUrlML(CATALOGO_REAL)
    assert.equal(alvo.tipo, 'catalogo')
    assert.equal(alvo.tipo === 'catalogo' && alvo.catalogoId, 'MLBU3472391724')
  })

  test('o id de rastreio no fragmento NÃO é confundido com o anúncio', () => {
    // Este é o teste que importa. `wid=MLB5099887766` está na URL e não pode
    // sair daqui como se fosse o anúncio aberto.
    assert.equal(extrairItemId(CATALOGO_REAL), null)
    assert.notEqual(extrairItemId(CATALOGO_REAL), 'MLB5099887766')
  })

  test('id em parâmetro de busca também não vale, mesmo sem catálogo no caminho', () => {
    const busca = 'https://lista.mercadolivre.com.br/mosquiteiro?wid=MLB5099887766&sid=search'
    assert.equal(extrairItemId(busca), null)
    assert.equal(classificarUrlML(busca).tipo, 'nenhum')
  })
})

describe('classificar link do ML — os formatos que funcionam', () => {
  test('anúncio clássico, com hífen', () => {
    const u = 'https://produto.mercadolivre.com.br/MLB-1234567890-furadeira-tok'
    assert.deepEqual(classificarUrlML(u), { tipo: 'anuncio', itemId: 'MLB1234567890' })
    assert.equal(extrairItemId(u), 'MLB1234567890')
  })

  test('anúncio sem hífen', () => {
    assert.equal(extrairItemId('https://www.mercadolivre.com.br/algo/MLB1234567890'), 'MLB1234567890')
  })

  test('o rastreio depois do anúncio não atrapalha — vence o do caminho', () => {
    // Quando OS DOIS existem, o do caminho é o que a pessoa está vendo.
    const u = 'https://produto.mercadolivre.com.br/MLB-1111111111-x?wid=MLB9999999999'
    assert.equal(extrairItemId(u), 'MLB1111111111')
  })

  test('catálogo /p/ também é catálogo', () => {
    const alvo = classificarUrlML('https://www.mercadolivre.com.br/furadeira/p/MLB12345678')
    assert.equal(alvo.tipo, 'catalogo')
  })
})

describe('classificar link do ML — os limites', () => {
  test('MLBU não é lido como MLB seguido de dígitos', () => {
    // Sem a guarda `(?![A-Z])`, "MLBU3472391724" viraria o item "MLB3472391724"
    // — um id inventado, que pode existir e ser de outro produto qualquer.
    const alvo = classificarUrlML('https://www.mercadolivre.com.br/x/MLBU3472391724')
    assert.notEqual(alvo.tipo, 'anuncio')
  })

  test('texto que não é URL não quebra — pode ser o id colado sozinho', () => {
    assert.equal(extrairItemId('MLB-1234567890'), 'MLB1234567890')
    assert.equal(classificarUrlML('qualquer coisa').tipo, 'nenhum')
  })

  test('link vazio não vira id', () => {
    assert.equal(extrairItemId(''), null)
  })
})
