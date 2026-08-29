import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { avaliarPreco, avaliarPrecos, precificarPorObjetivo, precificarPorRegra, type EconomiaResolvida } from '../../src/lib/precificacao/cenarios'
import { calcular } from '../../src/lib/precificacao/motor'
import type { Regra } from '../../src/lib/precificacao/regras'

// A GARANTIA CENTRAL DA FASE 1.
//
// Simulador, análise, recálculo em massa e ajustar-item passaram a montar a
// economia pelo mesmo `contexto.ts` e a chamar o motor pelas mesmas funções
// daqui. O que estes testes prendem é a propriedade que torna isso útil:
//
//   dada a MESMA economia, precificar por objetivo e depois AVALIAR o preço
//   resultante têm de devolver a mesma conta.
//
// Sem isso, "as três telas concordam" seria promessa de arquitetura em vez de
// comportamento verificável.

const ECONOMIA: EconomiaResolvida = {
  cfg: {
    canalId: null, plataforma: 'teste', nome: 'Canal de teste',
    comissaoModo: 'faixas', comissaoPercentual: 0, comissaoFixo: 0,
    comissaoFaixas: [
      { min: 0, max: 79.99, percentual: 20, fixo: 4 },
      { min: 80, max: null, percentual: 14, fixo: 16 },
    ],
    taxas: [{ nome: 'Antecipação', tipo: 'percentual', valor: 2, base: 'preco' }],
    freteModo: 'gratis_acima', freteValor: 0, freteLimiteGratis: 79, freteCustoMedio: 22, freteFaixas: [],
    embalagem: { nome: 'Caixa', tipo: 'fixo', valor: 1.5 },
    imposto: { nome: 'Simples', tipo: 'percentual', valor: 6, base: 'preco' },
    custosExtras: [], diasRecebimento: 14,
    faixasSaude: { critica: 5, baixa: 10, saudavel: 20 },
  },
  custo: 40,
  pesoKg: 1,
  freteFaixas: null,
}

const regra = (p: Partial<Regra>): Regra => ({
  id: 'r', nome: 'Regra', nivel: 'empresa', alvoId: null, alvoTexto: null, canalId: null,
  objetivoTipo: p.objetivoTipo ?? 'margem_liquida', objetivoValor: p.objetivoValor ?? 20,
  margemMinima: p.margemMinima ?? null, margemPromocionalMinima: p.margemPromocionalMinima ?? null, arredondamento: p.arredondamento ?? 'nenhum', prioridade: 0,
})

describe('cenários — avaliar um preço candidato', () => {
  test('avaliarPreco é exatamente o motor com objetivo "preço"', () => {
    const pelaPorta = avaliarPreco(ECONOMIA, 129.9)
    const direto = calcular({
      cfg: ECONOMIA.cfg, custoProduto: ECONOMIA.custo, pesoKg: ECONOMIA.pesoKg,
      freteFaixas: ECONOMIA.freteFaixas, objetivo: { tipo: 'preco', valor: 129.9 },
    })
    assert.deepEqual(pelaPorta.resultado, direto)
  })

  test('não arredonda o preço candidato — ele veio de fora', () => {
    // Uma campanha do marketplace pode propor R$ 59,90 ou R$ 59,93. Mexer
    // nesse número responderia outra pergunta.
    for (const p of [59.9, 59.93, 100.01]) {
      assert.equal(avaliarPreco(ECONOMIA, p).resultado.preco, p)
    }
  })

  test('devolve tudo que a Inteligência Comercial vai precisar', () => {
    const c = avaliarPreco(ECONOMIA, 129.9)
    const r = c.resultado
    for (const campo of ['preco', 'comissao', 'frete', 'imposto', 'embalagem', 'custosExtras', 'lucro', 'margemLiquida', 'markup', 'roi'] as const) {
      assert.equal(typeof r[campo], 'number', `faltou ${campo}`)
    }
    assert.ok(r.regime, 'o regime usado precisa vir junto')
    assert.ok(Array.isArray(r.linhas) && r.linhas.length > 0)
    assert.ok(Array.isArray(r.avisos))
    assert.equal(typeof c.saude, 'string')
    assert.equal(c.lucroSobreCusto, Number(r.roi.toFixed(2)))
    assert.equal(c.valido, true)
  })

  test('o regime informa a comissão e o frete que valeram naquele preço', () => {
    const barato = avaliarPreco(ECONOMIA, 60)
    assert.equal(barato.resultado.regime?.comissaoPercentual, 20)
    assert.equal(barato.resultado.regime?.frete, 0)

    const caro = avaliarPreco(ECONOMIA, 150)
    assert.equal(caro.resultado.regime?.comissaoPercentual, 14)
    assert.equal(caro.resultado.regime?.frete, 22)
    assert.match(caro.resultado.regime!.descricao, /comissão 14%/)
  })

  test('vários preços de uma vez, na mesma economia', () => {
    const cenarios = avaliarPrecos(ECONOMIA, [
      { rotulo: 'preço base', preco: 129.9 },
      { rotulo: 'campanha', preco: 99.9 },
      { rotulo: 'atacado 10un', preco: 89.9 },
    ])
    assert.equal(cenarios.length, 3)
    assert.deepEqual(cenarios.map(c => c.rotulo), ['preço base', 'campanha', 'atacado 10un'])
    // Quanto mais barato, menos sobra — a comparação que a Fase 2 vai fazer.
    assert.ok(cenarios[0].resultado.lucro > cenarios[1].resultado.lucro)
    assert.ok(cenarios[1].resultado.lucro > cenarios[2].resultado.lucro)
  })

  test('preço que não fecha vem marcado como inválido, não escondido', () => {
    const c = avaliarPreco(ECONOMIA, 0)
    assert.equal(c.valido, false)
  })
})

describe('cenários — ida e volta entre as telas', () => {
  // Esta é a prova de que simular, analisar e recalcular não podem divergir:
  // precificar e avaliar são a mesma matemática sobre a mesma economia.
  for (const objetivo of [
    { tipo: 'margem_liquida', valor: 20 },
    { tipo: 'margem_liquida', valor: 35 },
    { tipo: 'sobre_custo', valor: 60 },
    { tipo: 'markup', valor: 3 },
    { tipo: 'lucro_fixo', valor: 30 },
  ] as const) {
    test(`${objetivo.tipo} ${objetivo.valor}: avaliar o preço devolve a mesma conta`, () => {
      const precificado = precificarPorObjetivo(ECONOMIA, objetivo)
      const avaliado = avaliarPreco(ECONOMIA, precificado.resultado.preco)
      assert.deepEqual(avaliado.resultado, precificado.resultado)
      assert.equal(avaliado.saude, precificado.saude)
      assert.equal(avaliado.lucroSobreCusto, precificado.lucroSobreCusto)
    })
  }

  test('regra: o preço da regra avaliado devolve a mesma margem', () => {
    const porRegra = precificarPorRegra(ECONOMIA, regra({ objetivoTipo: 'margem_liquida', objetivoValor: 25 }))
    const avaliado = avaliarPreco(ECONOMIA, porRegra.resultado.preco)
    assert.equal(avaliado.resultado.preco, porRegra.resultado.preco)
    assert.equal(avaliado.resultado.comissao, porRegra.resultado.comissao)
    assert.equal(avaliado.resultado.frete, porRegra.resultado.frete)
    assert.equal(avaliado.resultado.lucro, porRegra.resultado.lucro)
    assert.equal(avaliado.saude, porRegra.saude)
  })

  test('o piso de margem chega ao cenário, com a marca de que interveio', () => {
    const semPiso = precificarPorRegra(ECONOMIA, regra({ objetivoTipo: 'markup', objetivoValor: 1.3 }))
    const comPiso = precificarPorRegra(ECONOMIA, regra({ objetivoTipo: 'markup', objetivoValor: 1.3, margemMinima: 18 }))
    assert.equal(semPiso.margemMinimaAplicada, false)
    assert.equal(comPiso.margemMinimaAplicada, true)
    assert.ok(comPiso.resultado.preco > semPiso.resultado.preco)
  })
})

describe('regressão — a paginação da varredura precisa ser determinística', () => {
  // Teste estrutural, e não de comportamento, porque o defeito só aparece
  // contra o banco: `varrerRecalculo` paginava `marketplace_anuncios` com
  // `.range()` sem `.order()`. Sem ordem declarada o Postgres não promete a
  // mesma ordem entre duas requisições, e a paginação repete e perde linha —
  // intermitente, que é o pior tipo. Com 9.232 anúncios são 10 páginas por
  // canal, então a chance não é teórica.
  test('recalculo.ts ordena antes de paginar', () => {
    const fonte = readFileSync(new URL('../../src/lib/precificacao/recalculo.ts', import.meta.url), 'utf8')
    const posOrder = fonte.indexOf('.order(')
    const posRange = fonte.indexOf('.range(')
    assert.ok(posOrder > -1, 'a consulta paginada perdeu o .order()')
    assert.ok(posRange > -1, 'esperava encontrar a paginação por .range()')
    assert.ok(posOrder < posRange, '.order() precisa vir antes do .range() na mesma consulta')
  })
})
