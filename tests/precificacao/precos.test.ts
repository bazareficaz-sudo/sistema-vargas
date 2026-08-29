import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { precosDoAnuncio, precoEfetivo } from '../../src/lib/precificacao/precos'

// Vocabulário canônico de preços.
//
// Estes testes prendem a MUDANÇA DE COMPORTAMENTO da Fase 1: a expressão
// antiga (`preco_promocional || preco_venda`) ignorava `promo_inicio` e
// `promo_fim`, exatamente como a etiqueta de prateleira ignorava a vigência
// da promoção do ERP. Promoção vencida valia para sempre.

const ONTEM = new Date('2026-08-27T12:00:00Z').toISOString()
const AMANHA = new Date('2026-08-29T12:00:00Z').toISOString()
const AGORA = new Date('2026-08-28T12:00:00Z')

describe('precos — decomposição', () => {
  test('sem promocional, o efetivo é a base', () => {
    const p = precosDoAnuncio({ preco_venda: 100 }, AGORA)
    assert.equal(p.base, 100)
    assert.equal(p.promocionalLocal, null)
    assert.equal(p.efetivo, 100)
    assert.equal(p.origemEfetivo, 'base')
    assert.equal(p.promocaoLocalVigente, false)
  })

  test('promocional sem janela vale — é o comportamento antigo, preservado', () => {
    const p = precosDoAnuncio({ preco_venda: 100, preco_promocional: 80 }, AGORA)
    assert.equal(p.efetivo, 80)
    assert.equal(p.origemEfetivo, 'promocional_local')
    assert.ok(p.promocaoLocalVigente)
  })

  test('promocional DENTRO da janela vale', () => {
    const p = precosDoAnuncio(
      { preco_venda: 100, preco_promocional: 80, promo_inicio: ONTEM, promo_fim: AMANHA }, AGORA,
    )
    assert.equal(p.efetivo, 80)
  })
})

describe('precos — a janela passou a ser respeitada', () => {
  test('promoção VENCIDA não vale mais: efetivo volta para a base', () => {
    const p = precosDoAnuncio(
      { preco_venda: 100, preco_promocional: 80, promo_fim: ONTEM }, AGORA,
    )
    assert.equal(p.promocionalLocal, 80, 'o número continua guardado')
    assert.equal(p.promocaoLocalVigente, false)
    assert.equal(p.efetivo, 100, 'mas quem vale é a base')
    assert.equal(p.origemEfetivo, 'base')
  })

  test('promoção que ainda não começou não vale', () => {
    const p = precosDoAnuncio(
      { preco_venda: 100, preco_promocional: 80, promo_inicio: AMANHA }, AGORA,
    )
    assert.equal(p.efetivo, 100)
  })

  test('data inválida não derruba nem invalida a promoção', () => {
    const p = precosDoAnuncio(
      { preco_venda: 100, preco_promocional: 80, promo_fim: 'não é data' }, AGORA,
    )
    assert.equal(p.efetivo, 80)
  })
})

describe('precos — dado sujo', () => {
  test('promocional MAIOR que a base é ignorado', () => {
    // Mesma regra de lib/produtos/promocao.ts: "promoção" mais cara que o
    // preço não é promoção, é cadastro errado.
    const p = precosDoAnuncio({ preco_venda: 100, preco_promocional: 120 }, AGORA)
    assert.equal(p.efetivo, 100)
    assert.equal(p.promocaoLocalVigente, false)
  })

  test('promocional igual à base é ignorado', () => {
    const p = precosDoAnuncio({ preco_venda: 100, preco_promocional: 100 }, AGORA)
    assert.equal(p.efetivo, 100)
  })

  test('promocional zero ou nulo não conta', () => {
    assert.equal(precosDoAnuncio({ preco_venda: 100, preco_promocional: 0 }, AGORA).efetivo, 100)
    assert.equal(precosDoAnuncio({ preco_venda: 100, preco_promocional: null }, AGORA).efetivo, 100)
  })

  test('anúncio sem preço nenhum devolve zero, não NaN', () => {
    const p = precosDoAnuncio({}, AGORA)
    assert.equal(p.base, 0)
    assert.equal(p.efetivo, 0)
  })

  test('base zero com promocional: o promocional vale', () => {
    // Anúncio recém-criado sem preço espelhado ainda não tem base com que
    // comparar — aí o promocional é a única informação de preço que existe.
    const p = precosDoAnuncio({ preco_venda: 0, preco_promocional: 50 }, AGORA)
    assert.equal(p.efetivo, 50)
  })
})

describe('precos — atalho', () => {
  test('precoEfetivo devolve o mesmo número da decomposição', () => {
    const a = { preco_venda: 100, preco_promocional: 80, promo_fim: AMANHA }
    assert.equal(precoEfetivo(a, AGORA), precosDoAnuncio(a, AGORA).efetivo)
  })
})
