import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { urlDoProdutoNaVitrine } from '../../src/lib/commerce/urlProduto'

// O selo LO na lista de produtos leva para a página do produto na vitrine.
// Estas são as combinações que decidem se existe endereço para levar.
//
// O endereço real deste sistema, conferido em produção em 01/09/2026:
//   https://bazareficaz.sistemavargas.com.br/produto/tela-mosquiteiro-velcro-1-3m-x-1-5m-25637

const RAIZ = 'sistemavargas.com.br'
const SLUG = 'tela-mosquiteiro-velcro-1-3m-x-1-5m-25637'

describe('endereço do produto na vitrine', () => {
  test('subdomínio da plataforma, que é o caso desta loja', () => {
    assert.equal(
      urlDoProdutoNaVitrine({ subdominio: 'bazareficaz', dominioProprio: null }, SLUG, RAIZ),
      `https://bazareficaz.${RAIZ}/produto/${SLUG}`,
    )
  })

  test('domínio próprio VENCE o subdomínio', () => {
    // É onde os clientes entram e o que o Google indexa. Levar para o
    // subdomínio funcionaria e divulgaria o endereço errado.
    assert.equal(
      urlDoProdutoNaVitrine({ subdominio: 'bazareficaz', dominioProprio: 'loja.bazareficaz.com.br' }, SLUG, RAIZ),
      `https://loja.bazareficaz.com.br/produto/${SLUG}`,
    )
  })
})

describe('quando NÃO há endereço para oferecer', () => {
  // Em todos estes o selo continua mostrando o estado — só não vira link.
  // `undefined` e não string vazia: `href=""` recarrega a página atual, que é
  // um link parecendo funcionar e não indo a lugar nenhum.

  test('produto sem slug', () => {
    assert.equal(urlDoProdutoNaVitrine({ subdominio: 'bazareficaz' }, null, RAIZ), undefined)
    assert.equal(urlDoProdutoNaVitrine({ subdominio: 'bazareficaz' }, '   ', RAIZ), undefined)
  })

  test('loja sem domínio nenhum configurado', () => {
    assert.equal(urlDoProdutoNaVitrine({ subdominio: null, dominioProprio: null }, SLUG, RAIZ), undefined)
  })

  test('sem domínio raiz no ambiente, o subdomínio não vira endereço', () => {
    // Sem `NEXT_PUBLIC_LOJA_DOMINIO_RAIZ` sairia `https://bazareficaz./produto/x`.
    assert.equal(urlDoProdutoNaVitrine({ subdominio: 'bazareficaz' }, SLUG, ''), undefined)
  })

  test('empresa sem loja', () => {
    assert.equal(urlDoProdutoNaVitrine(null, SLUG, RAIZ), undefined)
    assert.equal(urlDoProdutoNaVitrine(undefined, SLUG, RAIZ), undefined)
  })
})
