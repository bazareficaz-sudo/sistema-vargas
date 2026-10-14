import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  arredondarFinal, descontoSobrePecas, markupDe, montarKit, precoComDesconto, precoComMarkup, sugerirPrecoKit,
  type ComponenteDoKit,
} from '../../src/lib/produtos/kitsDaEntrada'

const peca = (over: Partial<ComponenteDoKit> = {}): ComponenteDoKit => ({
  produtoId: 'p1', nome: 'TUBO 50MM', sku: '1', quantidade: 1, precoVenda: 10, precoAntes: null,
  custo: 5, daEntrada: true, ...over,
})
const base = { kitId: 'k1', nome: 'KIT', sku: 'K1', precoAtual: 18, revisadoDepois: false, promocao: null }

describe('sugestão de preço do kit', () => {
  test('mantém o desconto que o kit tinha sobre as peças', () => {
    // Peças somavam 20, kit a 18 (10% off). A peça subiu para 12 → soma 24.
    assert.equal(sugerirPrecoKit({ precoAtual: 18, somaPecas: 24, somaPecasAntes: 20, revisadoDepois: false }), 21.6)
  })

  test('kit que era a soma exata continua a soma exata', () => {
    assert.equal(sugerirPrecoKit({ precoAtual: 20, somaPecas: 24, somaPecasAntes: 20, revisadoDepois: false }), 24)
  })

  test('sem preço anterior das peças não há sugestão', () => {
    assert.equal(sugerirPrecoKit({ precoAtual: 18, somaPecas: 24, somaPecasAntes: null, revisadoDepois: false }), null)
  })

  test('soma das peças igual: nada a sugerir', () => {
    assert.equal(sugerirPrecoKit({ precoAtual: 18, somaPecas: 20, somaPecasAntes: 20, revisadoDepois: false }), null)
  })

  test('kit já revisto depois da nota não recebe o reajuste de novo', () => {
    assert.equal(sugerirPrecoKit({ precoAtual: 21.6, somaPecas: 24, somaPecasAntes: 20, revisadoDepois: true }), null)
  })
})

describe('montar kit', () => {
  test('soma peças e custo pela quantidade; peça de fora da nota entra pelo preço de hoje', () => {
    const k = montarKit(base, [
      peca({ produtoId: 'a', quantidade: 2, precoVenda: 12, precoAntes: 10, custo: 6 }),
      peca({ produtoId: 'b', quantidade: 1, precoVenda: 5, precoAntes: null, custo: 2, daEntrada: false }),
    ])
    assert.equal(k.somaPecas, 29)
    assert.equal(k.somaPecasAntes, 25)
    assert.equal(k.custo, 14)
    assert.equal(k.custoConfiavel, true)
    assert.equal(k.sugestao, 20.88) // 18 / 25 × 29
  })

  test('peça sem custo deixa o custo do kit não confiável', () => {
    const k = montarKit(base, [peca({ custo: 0 }), peca({ produtoId: 'b' })])
    assert.equal(k.custoConfiavel, false)
  })

  test('nenhuma peça com preço anterior: sem soma anterior e sem sugestão', () => {
    const k = montarKit(base, [peca()])
    assert.equal(k.somaPecasAntes, null)
    assert.equal(k.sugestao, null)
  })
})

describe('atalhos de preço', () => {
  test('desconto sobre as peças e markup sobre o custo', () => {
    assert.equal(precoComDesconto(24, 10), 21.6)
    assert.equal(precoComMarkup(14, 60), 22.4)
  })

  test('indicadores', () => {
    assert.equal(Math.round(markupDe(21, 14)! * 10) / 10, 50)
    assert.equal(markupDe(21, 0), null)
    assert.equal(Math.round(descontoSobrePecas(21.6, 24)! * 10) / 10, 10)
    assert.ok(descontoSobrePecas(30, 24)! < 0) // kit mais caro que as peças
  })

  test('arredondar para ,90 e ,99', () => {
    assert.equal(arredondarFinal(21.6, '.90'), 21.9)
    assert.equal(arredondarFinal(21.6, '.99'), 21.99)
    assert.equal(arredondarFinal(0, '.90'), 0)
  })
})
