import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { urlDoProdutoNaVitrine, linkCompartilharWhatsApp } from '../../src/lib/commerce/urlProduto'

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

describe('link de compartilhamento no WhatsApp', () => {
  test('abre a escolha de contato, sem número de destino', () => {
    // `wa.me/?text=` sem número faz o WhatsApp perguntar para quem enviar —
    // é o que permite mandar do número do próprio vendedor.
    const l = linkCompartilharWhatsApp(`https://bazareficaz.${RAIZ}/produto/${SLUG}`)
    assert.ok(l?.startsWith('https://wa.me/?text='), `veio ${l}`)
    assert.ok(!/wa\.me\/\d/.test(l ?? ''), 'não pode ter número fixo de destino')
  })

  test('o endereço vai codificado — sem isso a query string quebra o link', () => {
    const l = linkCompartilharWhatsApp('https://loja.com/produto/tela-1,3m?x=1&y=2')
    assert.ok(l?.includes('%3A%2F%2F'), 'os :// precisam ir escapados')
    assert.ok(!l?.includes('&y=2'), 'o & do endereço não pode virar separador do wa.me')
  })

  test('sem endereço não há link', () => {
    assert.equal(linkCompartilharWhatsApp(undefined), undefined)
    assert.equal(linkCompartilharWhatsApp('  '), undefined)
  })
})
