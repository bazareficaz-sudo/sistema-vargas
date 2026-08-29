import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calcular, arredondar, faixaComissao, freteDaFaixa, saudeDaMargem } from '../../src/lib/precificacao/motor'
import type { ConfigTaxas } from '../../src/lib/precificacao/tipos'

// Testes de CARACTERIZAÇÃO do motor financeiro.
//
// Registram o comportamento que o motor JÁ TINHA antes da unificação da Fase
// 1. Não são a especificação do que ele deveria fazer: são a prova de que ele
// continua fazendo o mesmo. Se um deles quebrar numa refatoração futura, ou a
// refatoração está errada ou a mudança é intencional e o teste precisa ser
// reescrito junto com a justificativa.
//
// Os números foram medidos rodando o motor antes de qualquer alteração.

const CFG: ConfigTaxas = {
  canalId: null, plataforma: 'teste', nome: 'Canal de teste',
  comissaoModo: 'faixas', comissaoPercentual: 0, comissaoFixo: 0,
  comissaoFaixas: [
    { min: 0, max: 79.99, percentual: 20, fixo: 4 },
    { min: 80, max: null, percentual: 14, fixo: 16 },
  ],
  taxas: [],
  freteModo: 'gratis_acima', freteValor: 0, freteLimiteGratis: 79, freteCustoMedio: 22, freteFaixas: [],
  embalagem: null, imposto: null, custosExtras: [], diasRecebimento: 14,
}

const perto = (a: number, b: number, tol = 0.02) =>
  assert.ok(Math.abs(a - b) <= tol, `esperava ~${b}, veio ${a} (tolerância ${tol})`)

describe('motor — degraus de comissão e de frete', () => {
  // O degrau é a razão de o motor existir na forma que existe. Estes quatro
  // preços cercam as duas descontinuidades: o frete grátis em R$ 79 e a troca
  // de faixa de comissão em R$ 80.
  test('R$ 78,99 — última posição antes do frete grátis', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'preco', valor: 78.99 } })
    perto(r.comissao, 19.80)
    assert.equal(r.frete, 0, 'abaixo do limite quem paga o frete é o comprador')
    perto(r.lucro, 29.19)
  })

  test('R$ 79,00 — o frete liga e o lucro despenca', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'preco', valor: 79 } })
    perto(r.comissao, 19.80, 0.03)
    assert.equal(r.frete, 22, 'no limite o custo do frete passa a ser do vendedor')
    perto(r.lucro, 7.20)
    // Um centavo a mais no preço tira R$ 22 do lucro: é este salto que
    // impede resolver a fórmula uma vez só para toda a reta.
  })

  test('R$ 79,99 — ainda na primeira faixa de comissão', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'preco', valor: 79.99 } })
    perto(r.comissao, 20.00)
    assert.equal(r.frete, 22)
  })

  test('R$ 80,00 — troca de faixa: percentual cai, fixo sobe', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'preco', valor: 80 } })
    perto(r.comissao, 27.20, 0.01) // 14% de 80 + R$ 16 fixo
    assert.equal(r.frete, 22)
    perto(r.lucro, 0.80)
  })
})

describe('motor — resolução do preço por objetivo', () => {
  test('margem líquida escolhe a solução VÁLIDA mais barata', () => {
    // Com custo 30 e margem 20% existem duas soluções coerentes: R$ 56,67 no
    // regime sem frete e R$ 103,03 no regime com frete e comissão menor. As
    // duas entregam a margem pedida; o motor fica com a mais competitiva.
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'margem_liquida', valor: 20 } })
    perto(r.preco, 56.67)
    perto(r.margemLiquida, 20, 0.05)
    assert.equal(r.avisos.length, 0)
  })

  test('custo que não cabe no regime barato salta para o caro', () => {
    // Com custo 45 nenhuma solução cabe abaixo do frete grátis: o motor
    // atravessa a zona morta em vez de devolver um preço que não fecha.
    const r = calcular({ cfg: CFG, custoProduto: 45, objetivo: { tipo: 'margem_liquida', valor: 20 } })
    perto(r.preco, 125.76)
    perto(r.margemLiquida, 20, 0.05)
    assert.equal(r.frete, 22)
  })

  test('lucro sobre o custo entrega exatamente o ROI pedido', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'sobre_custo', valor: 50 } })
    perto(r.preco, 61.25)
    perto(r.roi, 50, 0.05)
    perto(r.lucro, 15)
  })

  test('markup é definição direta sobre o custo, sem passar pelas deduções', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'markup', valor: 2.5 } })
    assert.equal(r.preco, 75)
    perto(r.markup, 2.5, 0.001)
  })

  test('lucro fixo entrega o valor em reais pedido', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'lucro_fixo', valor: 25 } })
    perto(r.preco, 73.75)
    perto(r.lucro, 25)
  })

  test('nenhum regime fecha: devolve zero e AVISA, não inventa preço', () => {
    const impossivel: ConfigTaxas = {
      ...CFG, comissaoModo: 'simples', comissaoPercentual: 85, comissaoFixo: 0, comissaoFaixas: [],
    }
    const r = calcular({ cfg: impossivel, custoProduto: 30, objetivo: { tipo: 'margem_liquida', valor: 30 } })
    assert.equal(r.preco, 0)
    assert.ok(r.avisos.length >= 1, 'preço impossível precisa vir acompanhado de aviso')
    assert.ok(r.avisos.some(a => a.includes('100%')), 'o aviso precisa dizer que as taxas passam de 100%')
  })

  test('prejuízo é sinalizado', () => {
    const r = calcular({ cfg: CFG, custoProduto: 60, objetivo: { tipo: 'preco', valor: 79 } })
    assert.ok(r.lucro < 0)
    assert.ok(r.avisos.some(a => a.toLowerCase().includes('prejuízo')))
  })
})

describe('motor — ida e volta', () => {
  // Propriedade que a Fase 1 precisa preservar: precificar por objetivo e
  // depois AVALIAR o preço resultante têm de dar a mesma economia. É essa
  // equivalência que permite campanhas e preço por quantidade proporem um
  // preço e o mesmo motor responder quanto sobra.
  for (const custo of [12, 30, 45, 60, 120]) {
    for (const alvo of [10, 20, 35]) {
      test(`custo ${custo}, margem ${alvo}% — avaliar o preço devolve a mesma conta`, () => {
        const porObjetivo = calcular({ cfg: CFG, custoProduto: custo, objetivo: { tipo: 'margem_liquida', valor: alvo } })
        if (porObjetivo.preco === 0) return // caso impossível já coberto acima
        const porPreco = calcular({ cfg: CFG, custoProduto: custo, objetivo: { tipo: 'preco', valor: porObjetivo.preco } })
        assert.equal(porPreco.preco, porObjetivo.preco)
        perto(porPreco.comissao, porObjetivo.comissao, 0.01)
        assert.equal(porPreco.frete, porObjetivo.frete)
        perto(porPreco.lucro, porObjetivo.lucro, 0.01)
        perto(porPreco.margemLiquida, porObjetivo.margemLiquida, 0.01)
      })
    }
  }
})

describe('motor — arredondamento', () => {
  test('terminar em 90 sobe, nunca desce', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'margem_liquida', valor: 20 }, arredondamento: 'terminar_90' })
    assert.equal(r.preco, 56.90)
    assert.ok(r.margemLiquida > 20, 'arredondar para cima só pode aumentar a margem')
  })

  test('terminar em 99', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'margem_liquida', valor: 20 }, arredondamento: 'terminar_99' })
    assert.equal(r.preco, 56.99)
  })

  test('inteiro para cima', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'margem_liquida', valor: 20 }, arredondamento: 'cima_inteiro' })
    assert.equal(r.preco, 57)
  })

  test('a função de arredondar nunca devolve valor menor que a entrada', () => {
    for (const v of [10.01, 10.5, 10.89, 10.90, 10.91, 10.99, 11.00, 56.6666]) {
      for (const regra of ['terminar_90', 'terminar_99', 'cima_inteiro']) {
        assert.ok(arredondar(v, regra) >= v - 0.0001, `${regra} baixou ${v} para ${arredondar(v, regra)}`)
      }
    }
  })
})

describe('motor — frete importado tem precedência sobre o custo médio', () => {
  const FAIXAS = [
    { min: 0, max: 78.99, valor: 0 },
    { min: 79, max: 199.99, valor: 18.45 },
    { min: 200, max: null, valor: 30.75 },
  ]

  test('a escada do marketplace manda no preço E no detalhamento', () => {
    // O custo médio configurado é R$ 22; a escada real diz R$ 18,45 nesta
    // faixa. A tela precisa exibir o mesmo número que entrou na conta.
    const r = calcular({ cfg: CFG, custoProduto: 45, objetivo: { tipo: 'preco', valor: 150 }, freteFaixas: FAIXAS })
    assert.equal(r.frete, 18.45)
    const linhaFrete = r.linhas.find(l => l.rotulo === 'Frete')
    assert.equal(linhaFrete?.valor, 18.45)
  })

  test('faixa mais alta da escada', () => {
    const r = calcular({ cfg: CFG, custoProduto: 45, objetivo: { tipo: 'preco', valor: 250 }, freteFaixas: FAIXAS })
    assert.equal(r.frete, 30.75)
  })

  test('freteDaFaixa sem escada devolve zero', () => {
    assert.equal(freteDaFaixa(null, 100), 0)
    assert.equal(freteDaFaixa([], 100), 0)
  })
})

describe('motor — base do item de custo', () => {
  test('percentual sobre o CUSTO não muda quando o preço muda', () => {
    const cfg: ConfigTaxas = { ...CFG, custosExtras: [{ nome: 'Perdas', tipo: 'percentual', valor: 10, base: 'custo' }] }
    const a = calcular({ cfg, custoProduto: 50, objetivo: { tipo: 'preco', valor: 100 } })
    const b = calcular({ cfg, custoProduto: 50, objetivo: { tipo: 'preco', valor: 200 } })
    assert.equal(a.custosExtras, 5)
    assert.equal(b.custosExtras, 5)
  })

  test('percentual sobre o PREÇO acompanha o preço', () => {
    const cfg: ConfigTaxas = { ...CFG, custosExtras: [{ nome: 'Marketing', tipo: 'percentual', valor: 10, base: 'preco' }] }
    const a = calcular({ cfg, custoProduto: 50, objetivo: { tipo: 'preco', valor: 100 } })
    const b = calcular({ cfg, custoProduto: 50, objetivo: { tipo: 'preco', valor: 200 } })
    assert.equal(a.custosExtras, 10)
    assert.equal(b.custosExtras, 20)
  })

  test('configuração completa fecha a margem pedida', () => {
    const cfg: ConfigTaxas = {
      ...CFG,
      taxas: [{ nome: 'Antecipação', tipo: 'percentual', valor: 2, base: 'preco' }],
      embalagem: { nome: 'Caixa', tipo: 'fixo', valor: 1.5 },
      imposto: { nome: 'Simples', tipo: 'percentual', valor: 6, base: 'preco' },
      custosExtras: [{ nome: 'Perdas', tipo: 'percentual', valor: 3, base: 'custo' }],
    }
    const r = calcular({ cfg, custoProduto: 30, objetivo: { tipo: 'margem_liquida', valor: 20 } })
    assert.equal(r.preco, 70)
    perto(r.margemLiquida, 20, 0.05)
    assert.equal(r.embalagem, 1.5)
    assert.equal(r.custoTotal, 31.5, 'custo total inclui a embalagem')
  })
})

describe('motor — utilitários', () => {
  test('faixaComissao encontra a faixa do preço', () => {
    assert.equal(faixaComissao(CFG, 50).percentual, 20)
    assert.equal(faixaComissao(CFG, 79.99).percentual, 20)
    assert.equal(faixaComissao(CFG, 80).percentual, 14)
    assert.equal(faixaComissao(CFG, 5000).percentual, 14)
  })

  test('modo simples ignora as faixas', () => {
    const cfg: ConfigTaxas = { ...CFG, comissaoModo: 'simples', comissaoPercentual: 12, comissaoFixo: 3 }
    assert.equal(faixaComissao(cfg, 10).percentual, 12)
    assert.equal(faixaComissao(cfg, 10_000).percentual, 12)
  })

  test('saúde da margem respeita as faixas configuradas', () => {
    assert.equal(saudeDaMargem(-1), 'prejuizo')
    assert.equal(saudeDaMargem(3), 'critica')
    assert.equal(saudeDaMargem(7), 'baixa')
    assert.equal(saudeDaMargem(15), 'saudavel')
    assert.equal(saudeDaMargem(25), 'excelente')
    assert.equal(saudeDaMargem(15, { critica: 10, baixa: 20, saudavel: 30 }), 'baixa')
  })
})

describe('motor — memória de cálculo', () => {
  test('as linhas fecham a conta', () => {
    const r = calcular({ cfg: CFG, custoProduto: 30, objetivo: { tipo: 'preco', valor: 120 } })
    const preco = r.linhas.find(l => l.rotulo === 'Preço de venda')!.valor
    const lucro = r.linhas.find(l => l.rotulo === 'Lucro')!.valor
    const descontos = r.linhas
      .filter(l => l.sinal === '-')
      .reduce((s, l) => s + l.valor, 0)
    perto(preco - descontos, lucro, 0.02)
  })

  test('toda dedução com valor aparece na memória de cálculo', () => {
    const cfg: ConfigTaxas = {
      ...CFG,
      taxas: [{ nome: 'Antecipação', tipo: 'percentual', valor: 2, base: 'preco' }],
      imposto: { nome: 'Simples', tipo: 'percentual', valor: 6, base: 'preco' },
    }
    const r = calcular({ cfg, custoProduto: 30, objetivo: { tipo: 'preco', valor: 120 } })
    for (const rotulo of ['Custo do produto', 'Comissão do marketplace', 'Frete', 'Antecipação', 'Simples']) {
      assert.ok(r.linhas.some(l => l.rotulo === rotulo), `faltou a linha "${rotulo}"`)
    }
  })
})
