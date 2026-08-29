import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarFaixas, sugerirFaixas, cabeAtacado } from '../../src/lib/precificacao/quantidade'
import type { EconomiaResolvida } from '../../src/lib/precificacao/cenarios'
import type { Margens } from '../../src/lib/precificacao/margens'

// PREÇO POR QUANTIDADE.
//
// A regra que estes testes protegem: nenhuma faixa tem margem calculada fora
// do motor, e nenhuma sugestão ultrapassa o guardrail. O guardrail é o TETO da
// sugestão, não algo que se confere depois.

const COM_FRETE: EconomiaResolvida = {
  cfg: {
    canalId: null, plataforma: 'teste', nome: 'Canal com frete',
    comissaoModo: 'faixas', comissaoPercentual: 0, comissaoFixo: 0,
    comissaoFaixas: [
      { min: 0, max: 79.99, percentual: 20, fixo: 4 },
      { min: 80, max: null, percentual: 14, fixo: 16 },
    ],
    taxas: [], freteModo: 'gratis_acima', freteValor: 0, freteLimiteGratis: 79,
    freteCustoMedio: 22, freteFaixas: [],
    embalagem: null, imposto: null, custosExtras: [], diasRecebimento: 14,
    faixasSaude: { critica: 5, baixa: 10, saudavel: 20 },
  },
  custo: 60, pesoKg: 1, freteFaixas: null,
}

// Sem frete nenhum: nada a diluir. Serve para separar o efeito da diluição do
// efeito da política.
const SEM_FRETE: EconomiaResolvida = {
  ...COM_FRETE,
  cfg: { ...COM_FRETE.cfg, freteModo: 'nao', freteCustoMedio: 0, freteLimiteGratis: 0 },
  custo: 30,
}

const COM_POLITICA: Margens = { alvo: 25, promocionalMinima: 15, piso: 10 }
const SEM_POLITICA: Margens = { alvo: 25, promocionalMinima: null, piso: 10 }

describe('faixas — avaliação pelo motor', () => {
  test('cada faixa é avaliada NA SUA quantidade', () => {
    const avaliadas = avaliarFaixas(COM_FRETE, COM_POLITICA, [
      { qtd: 3, preco: 100 }, { qtd: 10, preco: 95 },
    ])
    assert.equal(avaliadas[0].resultado.quantidade, 3)
    assert.equal(avaliadas[1].resultado.quantidade, 10)
    // O frete do pedido é o mesmo; o rateio por unidade é que muda.
    assert.equal(avaliadas[0].resultado.pedido.frete, avaliadas[1].resultado.pedido.frete)
    assert.ok(avaliadas[1].resultado.frete < avaliadas[0].resultado.frete)
  })

  test('a faixa mais barata pode ter margem MAIOR, graças à diluição', () => {
    // É o resultado contraintuitivo que justifica a fase inteira: R$ 95 a 10
    // unidades deixa mais margem que R$ 100 a 3, porque o frete se divide.
    const [tres, dez] = avaliarFaixas(COM_FRETE, COM_POLITICA, [
      { qtd: 3, preco: 100 }, { qtd: 10, preco: 95 },
    ])
    assert.ok(dez.faixa.preco < tres.faixa.preco)
    assert.ok(
      dez.resultado.margemLiquida > tres.resultado.margemLiquida,
      `esperava margem maior em 10un (3un=${tres.resultado.margemLiquida}, 10un=${dez.resultado.margemLiquida})`,
    )
  })

  test('o lucro do PEDIDO é o que entra no caixa', () => {
    const [f] = avaliarFaixas(COM_FRETE, COM_POLITICA, [{ qtd: 10, preco: 95 }])
    assert.equal(f.lucroPedido, f.resultado.pedido.lucro)
    assert.ok(f.lucroPedido > f.resultado.lucro, 'dez unidades rendem mais que uma')
  })

  test('cada faixa vem classificada contra a política', () => {
    const avaliadas = avaliarFaixas(COM_FRETE, COM_POLITICA, [
      { qtd: 3, preco: 110 }, { qtd: 10, preco: 78 },
    ])
    for (const a of avaliadas) {
      assert.ok(['alvo', 'promocional', 'requer_aprovacao', 'bloqueado'].includes(a.classificacao.classificacao))
      assert.equal(a.liberado, a.classificacao.classificacao === 'alvo' || a.classificacao.classificacao === 'promocional')
    }
  })

  test('faixa inválida é descartada, não vira preço zero', () => {
    const avaliadas = avaliarFaixas(COM_FRETE, COM_POLITICA, [
      { qtd: 1, preco: 100 }, { qtd: 5, preco: 0 }, { qtd: 3, preco: 95 },
    ])
    assert.equal(avaliadas.length, 1)
    assert.equal(avaliadas[0].faixa.qtd, 3)
  })

  test('as faixas saem ordenadas por quantidade', () => {
    const avaliadas = avaliarFaixas(COM_FRETE, COM_POLITICA, [
      { qtd: 10, preco: 90 }, { qtd: 3, preco: 100 }, { qtd: 5, preco: 95 },
    ])
    assert.deepEqual(avaliadas.map(a => a.faixa.qtd), [3, 5, 10])
  })
})

describe('faixas — sugestão a partir dos limites econômicos', () => {
  test('COM política: as faixas escalonam entre o alvo e o mínimo promocional', () => {
    const s = sugerirFaixas(COM_FRETE, COM_POLITICA)
    assert.ok(s.faixas.length > 0)
    assert.match(s.criterio, /escalonada/)

    const margens = s.avaliadas.map(a => a.resultado.margemLiquida)
    for (let i = 1; i < margens.length; i++) {
      assert.ok(margens[i] <= margens[i - 1] + 0.1, 'a margem não pode subir conforme a faixa cresce')
    }
    // NENHUMA faixa fura o mínimo promocional. Este é o guardrail.
    for (const a of s.avaliadas) {
      assert.ok(
        a.resultado.margemLiquida >= COM_POLITICA.promocionalMinima! - 0.15,
        `faixa de ${a.faixa.qtd}+ ficou em ${a.resultado.margemLiquida}%, abaixo do mínimo promocional`,
      )
      assert.notEqual(a.classificacao.classificacao, 'bloqueado')
      assert.notEqual(a.classificacao.classificacao, 'requer_aprovacao')
    }
  })

  test('os preços sugeridos caem conforme a quantidade sobe', () => {
    const s = sugerirFaixas(COM_FRETE, COM_POLITICA)
    for (let i = 1; i < s.faixas.length; i++) {
      assert.ok(s.faixas[i].preco < s.faixas[i - 1].preco)
    }
  })

  test('SEM política: mantém a margem alvo, e mesmo assim o preço cai', () => {
    // Desconto que não custa margem — o frete do pedido dilui. É o único que
    // pode ser sugerido sem uma política que autorize abrir mão de margem.
    const s = sugerirFaixas(COM_FRETE, SEM_POLITICA)
    assert.match(s.criterio, /alvo/)
    assert.ok(s.avisos.some(a => a.includes('mantêm a margem alvo')))
    for (const a of s.avaliadas) {
      assert.ok(Math.abs(a.resultado.margemLiquida - SEM_POLITICA.alvo) < 0.2,
        `esperava margem ~${SEM_POLITICA.alvo}%, veio ${a.resultado.margemLiquida}%`)
    }
    assert.ok(s.faixas.length > 0, 'a diluição do frete sozinha já justifica faixas')
    assert.ok(s.faixas[s.faixas.length - 1].preco < s.faixas[0].preco)
  })

  test('SEM política e SEM frete: nada a sugerir, e o motivo é dito', () => {
    const s = sugerirFaixas(SEM_FRETE, SEM_POLITICA)
    assert.equal(s.faixas.length, 0, 'sem folga e sem diluição, faixa nenhuma se justifica')
    assert.ok(s.avisos.some(a => a.includes('não sairia mais barata')))
  })

  test('as quantidades são configuráveis, não uma regra universal', () => {
    const s = sugerirFaixas(COM_FRETE, COM_POLITICA, { quantidades: [2, 4] })
    assert.deepEqual(s.faixas.map(f => f.qtd), [2, 4])
  })

  test('arredondamento chega ao preço sugerido', () => {
    const s = sugerirFaixas(COM_FRETE, COM_POLITICA, { arredondamento: 'terminar_90' })
    for (const f of s.faixas) {
      assert.ok(String(f.preco).endsWith('.9'), `esperava preço terminando em ,90 — veio ${f.preco}`)
    }
  })
})

describe('faixas — cabe atacado?', () => {
  test('com frete a diluir, cabe — e diz quanto', () => {
    const r = cabeAtacado(COM_FRETE, COM_POLITICA, 10)
    assert.equal(r.cabe, true)
    assert.ok(r.economiaPorUnidade > 0)
    assert.match(r.motivo, /dilui/)
  })

  test('sem frete mas com política, cabe pela política', () => {
    const r = cabeAtacado(SEM_FRETE, COM_POLITICA, 10)
    assert.equal(r.cabe, true)
    assert.match(r.motivo, /política promocional/)
  })

  test('sem frete e sem política, não cabe — e o motivo é econômico', () => {
    const r = cabeAtacado(SEM_FRETE, SEM_POLITICA, 10)
    assert.equal(r.cabe, false)
    assert.match(r.motivo, /só tiraria margem/)
  })
})
