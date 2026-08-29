import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolverRegra, aplicarRegra, type Regra } from '../../src/lib/precificacao/regras'
import { montarEstrategia } from '../../src/lib/precificacao/estrategia'
import { resolverPrecoEfetivo } from '../../src/lib/precificacao/precos'
import { classificarMargem, limitePromocionalEfetivo } from '../../src/lib/precificacao/margens'
import { recomendar } from '../../src/lib/precificacao/recomendacoes'
import { sinalDeEstoque, sinalDeVendas } from '../../src/lib/precificacao/sinais'
import type { EconomiaResolvida } from '../../src/lib/precificacao/cenarios'

// A POLÍTICA PROMOCIONAL CONTRA UM OBJETIVO QUE NÃO É MARGEM.
//
// Estes testes existem por causa do que a base de produção mostrou em
// 29/08/2026: das três regras cadastradas, DUAS usam `sobre_custo`. Nelas o
// número 20 não é 20% de margem — é 20% sobre o custo, que numa economia com
// comissão vira ~12% de margem líquida.
//
// O risco concreto: alguém olha "objetivo 20", cadastra piso promocional 15 e
// conclui que há 5 pontos de folga. Não há — o preço da regra já entrega 12%,
// abaixo do piso promocional. O sistema tem de enxergar isso, e não esconder.
//
// A garantia que se prende aqui: o piso promocional é SEMPRE comparado contra
// a margem líquida que o MOTOR apurou, nunca contra `objetivo_valor`.

const AGORA = new Date('2026-09-15T12:00:00Z')

// Canal com comissão e sem frete na faixa de preço usada, para a conta ficar
// conferível à mão: comissão 20% + R$ 4, frete só a partir de R$ 79.
const ECONOMIA: EconomiaResolvida = {
  cfg: {
    canalId: null, plataforma: 'teste', nome: 'Canal de teste',
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
  custo: 30, pesoKg: 1, freteFaixas: null,
}

const regra = (p: Partial<Regra>): Regra => ({
  id: p.id ?? 'r', nome: p.nome ?? 'Regra', nivel: p.nivel ?? 'empresa',
  alvoId: p.alvoId ?? null, alvoTexto: p.alvoTexto ?? null, canalId: p.canalId ?? null,
  objetivoTipo: p.objetivoTipo ?? 'margem_liquida', objetivoValor: p.objetivoValor ?? 20,
  margemMinima: p.margemMinima !== undefined ? p.margemMinima : null,
  margemPromocionalMinima: p.margemPromocionalMinima !== undefined ? p.margemPromocionalMinima : null,
  arredondamento: p.arredondamento ?? 'nenhum', prioridade: p.prioridade ?? 0,
})

const estrategiaDe = (r: Regra, precoNoAr: number) => montarEstrategia({
  economia: ECONOMIA,
  precos: resolverPrecoEfetivo({ anuncio: { id: 'a-1', preco_venda: precoNoAr }, agora: AGORA }),
  regra: r, agora: AGORA,
})

// ── As três regras que existem em produção ────────────────────────────────
// Copiadas da base em 29/08/2026, com os mesmos níveis e objetivos.
const GERAL_20 = regra({
  id: 'geral', nome: 'Geral 20%', nivel: 'produto', alvoId: 'prod-alvo',
  objetivoTipo: 'margem_liquida', objetivoValor: 20, prioridade: 99,
})
const ML_20 = regra({
  id: 'ml', nome: 'ML 20%', nivel: 'marca', alvoTexto: 'tok',
  objetivoTipo: 'sobre_custo', objetivoValor: 20,
})
const MARCA_TIGRE = regra({
  id: 'tigre', nome: 'Marca Tigre', nivel: 'empresa',
  objetivoTipo: 'sobre_custo', objetivoValor: 20,
})
const AS_TRES = [GERAL_20, ML_20, MARCA_TIGRE]
const CANAL = { id: 'canal-1', plataforma: 'mercadolivre' }

describe('objetivo sobre_custo NÃO é margem líquida', () => {
  test('sobre_custo 20% entrega 12% de margem, e a alvo derivada é 12', () => {
    // Conta conferível: preço = (30 x 1,20 + 4) / (1 - 0,20) = 50.
    // Comissão 50 x 20% + 4 = 14. Lucro = 50 - 30 - 14 = 6 = 20% do custo.
    // Margem líquida = 6 / 50 = 12%.
    const e = estrategiaDe(ML_20, 50)
    assert.equal(e.precoAlvo, 50)
    assert.ok(Math.abs(e.margens.alvo - 12) < 0.05, `alvo veio ${e.margens.alvo}`)
    assert.notEqual(e.margens.alvo, 20, 'a alvo NUNCA pode ser o objetivo_valor de sobre_custo')
    // O ROI, sim, é o número da regra.
    assert.ok(Math.abs(e.cenarioAlvo!.lucroSobreCusto - 20) < 0.05)
  })

  test('margem_liquida 20% entrega exatamente 20', () => {
    const e = estrategiaDe(GERAL_20, 61.82)
    assert.ok(Math.abs(e.margens.alvo - 20) < 0.05, `alvo veio ${e.margens.alvo}`)
  })

  test('as duas regras de 20 produzem alvos DIFERENTES', () => {
    // O mesmo "20" nas duas regras, e economias iguais: só o tipo muda.
    const porMargem = estrategiaDe(GERAL_20, 61.82).margens.alvo
    const porCusto = estrategiaDe(ML_20, 50).margens.alvo
    assert.ok(Math.abs(porMargem - porCusto) > 7,
      `esperava alvos bem diferentes; vieram ${porMargem} e ${porCusto}`)
  })
})

describe('o piso promocional é comparado contra a margem do MOTOR', () => {
  test('a armadilha: objetivo 20, piso promocional 15, e a regra já nasce fora da política', () => {
    // Quem lê "objetivo 20" e cadastra promocional 15 acredita ter 5 pontos de
    // folga. Não tem: o preço da regra entrega 12%, abaixo dos 15%.
    const r = regra({ ...ML_20, margemPromocionalMinima: 15 })
    const e = estrategiaDe(r, 50)

    assert.ok(Math.abs(e.margens.alvo - 12) < 0.05)
    assert.equal(e.margens.promocionalMinima, 15)

    // A classificação do preço no ar usa a margem apurada, não o objetivo.
    const c = classificarMargem(e.margemEfetiva, e.margens)
    assert.equal(c.classificacao, 'alvo', 'o preço da regra atinge a própria meta derivada')

    // E o limite promocional, sendo MAIOR que o alvo, não abre folga nenhuma:
    // não há preço abaixo do alvo que ainda respeite a política.
    assert.ok(e.precoPromocionalLimite! > e.precoAlvo,
      'com promocional acima do alvo, o limite fica ACIMA do preço da regra — sinal de política incoerente')
  })

  test('a classificação nunca usa objetivo_valor como se fosse margem', () => {
    // Prova por contradição: se o sistema comparasse 20 (objetivo) com a
    // margem efetiva, um preço de 12% seria "abaixo da meta". Ele compara com
    // a alvo derivada (12%), e o resultado é "meta atingida".
    const e = estrategiaDe(ML_20, 50)
    assert.equal(e.margemEfetiva, 12)
    assert.equal(e.classificacao.classificacao, 'alvo')
    assert.doesNotMatch(e.classificacao.motivo, /20,0%/,
      'o motivo não pode citar o 20 do objetivo como se fosse a meta de margem')
  })

  test('o piso de margem age sobre a conta do motor, subindo o preço', () => {
    const semPiso = aplicarRegra({ cfg: ECONOMIA.cfg, custoProduto: 30, regra: ML_20 })
    const comPiso = aplicarRegra({
      cfg: ECONOMIA.cfg, custoProduto: 30,
      regra: regra({ ...ML_20, margemMinima: 18 }),
    })
    assert.ok(Math.abs(semPiso.margemLiquida - 12) < 0.05)
    assert.equal(comPiso.margemMinimaAplicada, true)
    assert.ok(Math.abs(comPiso.margemLiquida - 18) < 0.05)
    assert.ok(comPiso.preco > semPiso.preco)
    assert.ok(comPiso.avisos.some(a => a.includes('abaixo do mínimo')))
  })
})

describe('margem_promocional_minima NULA', () => {
  test('o limite promocional vira o piso, e nada é aprovado sozinho', () => {
    const r = regra({ ...ML_20, margemMinima: 8, margemPromocionalMinima: null })
    const e = estrategiaDe(r, 50)
    assert.equal(e.margens.promocionalMinima, null)
    assert.equal(limitePromocionalEfetivo(e.margens), 8)
    assert.ok(e.flags.includes('sem_politica_promocional'))
    assert.equal(e.precoPromocionalLimite, e.precoPiso,
      'sem política declarada, o limite promocional e o piso são o mesmo preço')
  })

  test('sem política e sem piso, não há preço promocional limite nenhum', () => {
    const e = estrategiaDe(ML_20, 50)
    assert.equal(e.margens.promocionalMinima, null)
    assert.equal(e.margens.piso, null)
    assert.equal(e.precoPromocionalLimite, null)
    assert.equal(e.precoPiso, null)
  })

  test('é o caso de TODAS as regras hoje em produção', () => {
    for (const r of AS_TRES) {
      const e = estrategiaDe(r, 50)
      assert.equal(e.margens.promocionalMinima, null)
      assert.ok(e.flags.includes('sem_politica_promocional'))
    }
  })
})

describe('fluxo completo: regra cadastrada → preço → classificação → recomendação', () => {
  const produtoAlvo = { id: 'prod-alvo', categoria: 'Hidraulica', marca: 'tok' }
  const outroTok = { id: 'prod-tok', categoria: 'Hidraulica', marca: 'tok' }
  const qualquerOutro = { id: 'prod-x', categoria: 'Eletrica', marca: 'Tramontina' }

  test('a hierarquia resolve as três regras reais sem ambiguidade', () => {
    assert.equal(resolverRegra(AS_TRES, produtoAlvo, CANAL).vencedora?.id, 'geral')
    assert.equal(resolverRegra(AS_TRES, outroTok, CANAL).vencedora?.id, 'ml')
    assert.equal(resolverRegra(AS_TRES, qualquerOutro, CANAL).vencedora?.id, 'tigre')
  })

  test('o produto alvo é da marca tok e AS DUAS regras casam — produto vence', () => {
    const r = resolverRegra(AS_TRES, produtoAlvo, CANAL)
    const ids = r.candidatas.map(c => c.regra.id)
    assert.ok(ids.includes('geral') && ids.includes('ml') && ids.includes('tigre'),
      'as três casam com este produto')
    assert.equal(r.vencedora?.id, 'geral', 'produto (100) ganha de marca (50) e de empresa (10)')
    assert.deepEqual(ids, ['geral', 'ml', 'tigre'], 'a ordem das candidatas é a da força')
  })

  test('o fluxo inteiro, ponta a ponta, para um produto da marca tok', () => {
    const resolucao = resolverRegra(AS_TRES, outroTok, CANAL)
    const vencedora = resolucao.vencedora!
    assert.equal(vencedora.objetivoTipo, 'sobre_custo')

    const e = estrategiaDe(vencedora, 50)

    // A margem alvo saiu do motor, não da coluna.
    assert.ok(Math.abs(e.margens.alvo - 12) < 0.05)
    // O preço no ar é classificado contra essa alvo derivada.
    assert.equal(e.classificacao.classificacao, 'alvo')

    const estoque = sinalDeEstoque(90)
    const vendas = sinalDeVendas(estoque, { unidades: 30, dias: 30, pedidos: 12, maiorPedido: 4 })
    const rs = recomendar({ estrategia: e, estoque, vendas, agora: AGORA, campanhaSincronizadaEm: AGORA.toISOString() })

    // Sem política promocional declarada, o sistema avisa em vez de sugerir
    // desconto por conta própria.
    assert.ok(rs.some(x => x.tipo === 'sem_politica_promocional'))
    assert.ok(!rs.some(x => x.tipo === 'espaco_para_promocao'),
      'sem política declarada, nenhuma promoção pode ser oferecida como aprovada')

    // E toda recomendação carrega os números que a sustentam.
    for (const x of rs) {
      assert.ok(x.evidencias.some(ev => ev.rotulo === 'Margem alvo'))
      const alvo = x.evidencias.find(ev => ev.rotulo === 'Margem alvo')!
      assert.doesNotMatch(alvo.valor, /^20,0%$/, 'a evidência da alvo não pode repetir o objetivo_valor')
    }
  })

  test('um preço ruim atravessa o fluxo e vira recomendação, com o piso mandando', () => {
    const r = regra({ ...MARCA_TIGRE, margemMinima: 10, margemPromocionalMinima: 15 })
    const e = estrategiaDe(r, 40) // preço abaixo do que a regra pede

    const estoque = sinalDeEstoque(300)
    const vendas = sinalDeVendas(estoque, { unidades: 30, dias: 30, pedidos: 15, maiorPedido: 3 })
    const rs = recomendar({ estrategia: e, estoque, vendas, agora: AGORA, campanhaSincronizadaEm: AGORA.toISOString() })

    assert.equal(e.classificacao.classificacao, 'bloqueado')
    assert.equal(rs[0].tipo, 'abaixo_do_piso')
    assert.equal(rs[0].prioridade, 'critica')
    // Estoque parado não compra passagem para descer preço.
    assert.ok(!rs.some(x => x.tipo === 'margem_alta_estoque_parado'))
    assert.ok(!rs.some(x => x.tipo === 'espaco_para_promocao'))
  })
})
