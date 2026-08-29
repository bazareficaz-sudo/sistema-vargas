import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcular } from '../../src/lib/precificacao/motor'
import type { ConfigTaxas } from '../../src/lib/precificacao/tipos'

// QUANTIDADE E CUSTOS POR PEDIDO.
//
// O defeito que estes testes existem para impedir: o motor cobrava o frete por
// UNIDADE. Avaliar a faixa "10+ unidades" cobraria dez fretes e faria um preço
// de atacado saudável parecer prejuízo — e qualquer sugestão de atacado
// construída sobre isso estaria errada por construção.
//
// A evidência de que o frete é por pedido não é suposição: a Shopee grava
// `actual_shipping_fee` no PEDIDO (lib/shopee/orders.ts) e o Mercado Livre
// mantém o custo em `/shipments/{id}` (lib/mercadolivre/orders.ts).

const CFG: ConfigTaxas = {
  canalId: null, plataforma: 'teste', nome: 'Canal de teste',
  comissaoModo: 'faixas', comissaoPercentual: 0, comissaoFixo: 0,
  comissaoFaixas: [
    { min: 0, max: 79.99, percentual: 20, fixo: 4 },
    { min: 80, max: null, percentual: 14, fixo: 16 },
  ],
  taxas: [], freteModo: 'gratis_acima', freteValor: 0, freteLimiteGratis: 79,
  freteCustoMedio: 22, freteFaixas: [],
  embalagem: null, imposto: null, custosExtras: [], diasRecebimento: 14,
}

const perto = (a: number, b: number, tol = 0.02) =>
  assert.ok(Math.abs(a - b) <= tol, `esperava ~${b}, veio ${a}`)

const aPreco = (preco: number, quantidade: number, cfg = CFG, custo = 30) =>
  calcular({ cfg, custoProduto: custo, objetivo: { tipo: 'preco', valor: preco }, quantidade })

describe('quantidade — compatibilidade', () => {
  test('sem informar quantidade, a conta é a de sempre', () => {
    const semQtd = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'preco', valor: 120 } })
    const comUm = aPreco(120, 1)
    assert.deepEqual(semQtd, comUm)
    assert.equal(semQtd.quantidade, 1)
  })

  test('quantidade inválida cai em 1 em vez de dividir por zero', () => {
    for (const q of [0, -5, 0.4, NaN]) {
      const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'preco', valor: 120 }, quantidade: q })
      assert.equal(r.quantidade, 1)
      assert.equal(r.frete, 22)
    }
  })

  test('quantidade fracionária é truncada, não arredondada para cima', () => {
    assert.equal(aPreco(120, 3.9 as number).quantidade, 3)
  })
})

describe('quantidade — o frete é do PEDIDO, e rateia', () => {
  const casos: [number, number, number][] = [
    // quantidade, frete por unidade, lucro por unidade
    [1, 22.00, 35.20],
    [3, 7.33, 49.87],
    [5, 4.40, 52.80],
    [10, 2.20, 55.00],
  ]
  for (const [qtd, freteUnit, lucroUnit] of casos) {
    test(`${qtd} unidade(s) a R$ 120: frete/un ${freteUnit}`, () => {
      const r = aPreco(120, qtd)
      perto(r.frete, freteUnit)
      perto(r.lucro, lucroUnit)
      assert.equal(r.pedido.frete, 22, 'o frete do pedido é sempre um só')
      assert.equal(r.pedido.quantidade, qtd)
    })
  }

  test('o erro que isto conserta, medido', () => {
    // Multiplicar o lucro unitário de UMA unidade por dez era a conta antiga.
    const uma = aPreco(120, 1)
    const dez = aPreco(120, 10)
    const contaAntiga = uma.lucro * 10
    perto(dez.pedido.lucro, 550)
    perto(contaAntiga, 352)
    assert.ok(dez.pedido.lucro - contaAntiga > 190, 'a diferença por pedido passa de R$ 190')
  })

  test('a margem melhora com a quantidade quando há frete a diluir', () => {
    const margens = [1, 3, 5, 10].map(q => aPreco(120, q).margemLiquida)
    for (let i = 1; i < margens.length; i++) {
      assert.ok(margens[i] > margens[i - 1], 'mais unidades no mesmo envio não podem piorar a margem')
    }
  })

  test('sem frete a diluir, a quantidade não muda a margem unitária', () => {
    // A R$ 60 o frete é do comprador (abaixo do limite de R$ 79): não há custo
    // por pedido, e diluir nada dá nada.
    const uma = aPreco(60, 1)
    const dez = aPreco(60, 10)
    assert.equal(uma.frete, 0)
    assert.equal(dez.frete, 0)
    perto(dez.margemLiquida, uma.margemLiquida, 0.001)
    perto(dez.pedido.lucro, uma.lucro * 10, 0.05)
  })
})

describe('quantidade — totais do pedido', () => {
  test('receita, custo e lucro do pedido são os unitários vezes a quantidade', () => {
    const r = aPreco(120, 10)
    perto(r.pedido.receita, 1200)
    perto(r.pedido.custoTotal, 300)
    perto(r.pedido.lucro, r.lucro * 10, 0.05)
    perto(r.pedido.totalDeducoes, r.totalDeducoes * 10, 0.05)
  })

  test('com uma unidade, pedido e unidade são o mesmo número', () => {
    const r = aPreco(120, 1)
    assert.equal(r.pedido.receita, r.preco)
    assert.equal(r.pedido.lucro, r.lucro)
    assert.equal(r.pedido.frete, r.frete)
  })
})

describe('quantidade — objetivo de margem com frete diluído', () => {
  test('mais unidades permitem preço menor para a mesma margem', () => {
    // Custo 60 força o preço acima do limite de frete grátis, então há frete
    // para diluir e a quantidade muda o preço necessário.
    const uma = calcular({ cfg: CFG, custoProduto: 60, objetivo: { tipo: 'margem_liquida', valor: 25 }, quantidade: 1 })
    const dez = calcular({ cfg: CFG, custoProduto: 60, objetivo: { tipo: 'margem_liquida', valor: 25 }, quantidade: 10 })
    assert.ok(dez.preco < uma.preco, `esperava preço menor com 10 un (uma=${uma.preco}, dez=${dez.preco})`)
    perto(uma.margemLiquida, 25, 0.1)
    perto(dez.margemLiquida, 25, 0.1)
  })

  test('o preço resolvido continua respeitando os regimes', () => {
    const r = calcular({ cfg: CFG, custoProduto: 60, objetivo: { tipo: 'margem_liquida', valor: 25 }, quantidade: 10 })
    assert.ok(r.regime, 'o preço precisa pertencer a um regime')
    assert.equal(r.regime!.frete, r.pedido.frete, 'o regime informa o frete do PEDIDO, não o rateado')
  })

  test('avaliar o preço resolvido devolve a mesma conta — na mesma quantidade', () => {
    const porObjetivo = calcular({ cfg: CFG, custoProduto: 60, objetivo: { tipo: 'margem_liquida', valor: 25 }, quantidade: 5 })
    const porPreco = calcular({ cfg: CFG, custoProduto: 60, objetivo: { tipo: 'preco', valor: porObjetivo.preco }, quantidade: 5 })
    assert.deepEqual(porPreco, porObjetivo)
  })
})

describe('quantidade — custos marcados como POR PEDIDO', () => {
  test('embalagem por pedido rateia; por unidade não', () => {
    const porUnidade: ConfigTaxas = { ...CFG, embalagem: { nome: 'Caixa', tipo: 'fixo', valor: 5 } }
    const porPedido: ConfigTaxas = { ...CFG, embalagem: { nome: 'Caixa', tipo: 'fixo', valor: 5, porPedido: true } }

    const u = aPreco(120, 10, porUnidade)
    const p = aPreco(120, 10, porPedido)

    assert.equal(u.embalagem, 5, 'por unidade: cada uma leva a sua caixa')
    assert.equal(p.embalagem, 0.5, 'por pedido: uma caixa dividida por dez')
    perto(u.pedido.lucro, 500)
    perto(p.pedido.lucro, 545)
  })

  test('taxa fixa por pedido rateia', () => {
    const cfg: ConfigTaxas = { ...CFG, taxas: [{ nome: 'Etiqueta', tipo: 'fixo', valor: 3, porPedido: true }] }
    const r = aPreco(120, 10, cfg)
    perto(r.outrasTaxas, 0.3)
    perto(r.pedido.lucro, 547)
  })

  test('percentual sobre o PREÇO ignora porPedido — ele já acompanha a receita', () => {
    const semMarca: ConfigTaxas = { ...CFG, taxas: [{ nome: 'Marketing', tipo: 'percentual', valor: 5, base: 'preco' }] }
    const comMarca: ConfigTaxas = { ...CFG, taxas: [{ nome: 'Marketing', tipo: 'percentual', valor: 5, base: 'preco', porPedido: true }] }
    assert.equal(aPreco(120, 10, semMarca).outrasTaxas, aPreco(120, 10, comMarca).outrasTaxas)
  })

  test('percentual sobre o CUSTO marcado por pedido rateia', () => {
    const cfg: ConfigTaxas = { ...CFG, custosExtras: [{ nome: 'Manuseio', tipo: 'percentual', valor: 10, base: 'custo', porPedido: true }] }
    const r = aPreco(120, 10, cfg)
    perto(r.custosExtras, 0.3) // 10% de 30 = 3, dividido por 10
  })
})

describe('quantidade — a memória de cálculo conta o rateio', () => {
  test('a linha do frete diz que foi dividida', () => {
    const r = aPreco(120, 10)
    const linha = r.linhas.find(l => l.rotulo === 'Frete')
    assert.ok(linha, 'a linha do frete precisa existir')
    assert.match(linha!.detalhe ?? '', /por pedido/)
    assert.match(linha!.detalhe ?? '', /10 unidades/)
  })

  test('com uma unidade, nada de rateio aparece', () => {
    const linha = aPreco(120, 1).linhas.find(l => l.rotulo === 'Frete')
    assert.doesNotMatch(linha?.detalhe ?? '', /÷/)
  })
})
