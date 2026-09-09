import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { aplicarPolitica, markupDoPreco, precoDoMarkup } from '../../src/lib/entradas/politicaPreco'

// O CASO REAL QUE ORIGINOU A POLÍTICA.
//
// Nota da Ourolar: sete produtos, custo NOVO menor que o anterior em todos, e
// a tela sugerindo variação negativa em todos — de −1,2% a −14,1%. Com
// `manter_markup` isso está certo por definição. O ponto é que ninguém tinha
// escolhido `manter_markup`; era só o único comportamento que existia.
//
// Os números abaixo são os da própria nota.

const OUROLAR = [
  { nome: 'SELADORA BARRICA 16L', custoNovo: 39.99, precoAtual: 62.00, markupAtual: 41.23 },
  { nome: 'MASSA PVA BARRICA', custoNovo: 16.99, precoAtual: 25.80, markupAtual: 50.00 },
  { nome: 'MASSA ACRILICA BARRICA', custoNovo: 41.99, precoAtual: 62.00, markupAtual: 39.73 },
  { nome: 'TINTA ESMALTE 900ML BRANCO', custoNovo: 22.99, precoAtual: 39.90, markupAtual: 49.16 },
]

describe('política de preço quando o custo muda', () => {
  test('manter_markup: preço acompanha o custo para os dois lados', () => {
    const sobe = aplicarPolitica('manter_markup', { custoAnterior: 10, custoNovo: 12, precoAtual: 15, markupAtual: 50 })
    assert.equal(sobe.precoNovo, 18)
    assert.equal(sobe.markup, 50)

    const cai = aplicarPolitica('manter_markup', { custoAnterior: 10, custoNovo: 8, precoAtual: 15, markupAtual: 50 })
    assert.equal(cai.precoNovo, 12)
    assert.equal(cai.markup, 50)
  })

  test('manter_preco: o preço na prateleira não se mexe, o markup absorve', () => {
    const r = aplicarPolitica('manter_preco', { custoAnterior: 10, custoNovo: 8, precoAtual: 15, markupAtual: 50 })
    assert.equal(r.precoNovo, 15)
    assert.equal(r.markup, 87.5)
  })

  test('manter_preco também segura o preço quando o custo SOBE', () => {
    const r = aplicarPolitica('manter_preco', { custoAnterior: 10, custoNovo: 14, precoAtual: 15, markupAtual: 50 })
    assert.equal(r.precoNovo, 15)
    assert.equal(r.markup, 7.14)
  })

  test('so_aumentar: repassa a alta', () => {
    const r = aplicarPolitica('so_aumentar', { custoAnterior: 10, custoNovo: 12, precoAtual: 15, markupAtual: 50 })
    assert.equal(r.precoNovo, 18)
    assert.equal(r.markup, 50)
  })

  test('so_aumentar: NÃO devolve a queda — o desconto do fornecedor vira margem', () => {
    const r = aplicarPolitica('so_aumentar', { custoAnterior: 10, custoNovo: 8, precoAtual: 15, markupAtual: 50 })
    assert.equal(r.precoNovo, 15)
    assert.equal(r.markup, 87.5)
  })

  test('so_aumentar: custo igual mantém preço E markup', () => {
    const r = aplicarPolitica('so_aumentar', { custoAnterior: 10, custoNovo: 10, precoAtual: 15, markupAtual: 50 })
    assert.equal(r.precoNovo, 15)
    assert.equal(r.markup, 50)
  })

  test('A NOTA DA OUROLAR: so_aumentar não derruba nenhum dos sete preços', () => {
    for (const p of OUROLAR) {
      // Todos com custo em queda — é o que a coluna Variação mostrava em vermelho.
      const custoAnterior = p.precoAtual / (1 + p.markupAtual / 100)
      assert.ok(p.custoNovo < custoAnterior, `${p.nome}: o teste pressupõe custo em queda`)

      const r = aplicarPolitica('so_aumentar', { custoAnterior, custoNovo: p.custoNovo, precoAtual: p.precoAtual, markupAtual: p.markupAtual })
      assert.equal(r.precoNovo, p.precoAtual, `${p.nome}: o preço não deveria mudar`)
      assert.ok(r.markup > p.markupAtual, `${p.nome}: a margem deveria subir`)
    }
  })

  test('a mesma nota com manter_markup derruba os sete — o comportamento antigo', () => {
    for (const p of OUROLAR) {
      const custoAnterior = p.precoAtual / (1 + p.markupAtual / 100)
      const r = aplicarPolitica('manter_markup', { custoAnterior, custoNovo: p.custoNovo, precoAtual: p.precoAtual, markupAtual: p.markupAtual })
      assert.ok(r.precoNovo < p.precoAtual, `${p.nome}: era isto que acontecia sem escolha nenhuma`)
    }
  })

  test('custo novo zero não sugere preço zero nem markup infinito', () => {
    for (const pol of ['manter_markup', 'manter_preco', 'so_aumentar'] as const) {
      const r = aplicarPolitica(pol, { custoAnterior: 0, custoNovo: 0, precoAtual: 19.9, markupAtual: 30 })
      assert.equal(r.precoNovo, 19.9)
      assert.equal(r.markup, 30)
    }
  })

  test('produto novo (sem preço atual) mantém o markup informado em vez de virar markup 0', () => {
    const r = aplicarPolitica('manter_preco', { custoAnterior: 0, custoNovo: 10, precoAtual: 0, markupAtual: 45 })
    assert.equal(r.markup, 45)
  })

  test('markup e preço são inversos um do outro', () => {
    assert.equal(precoDoMarkup(10, 50), 15)
    assert.equal(markupDoPreco(10, 15), 50)
    assert.equal(markupDoPreco(0, 15), 0, 'custo zero não estoura')
  })
})
