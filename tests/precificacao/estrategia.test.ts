import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { montarEstrategia, simularCenarioPromocional } from '../../src/lib/precificacao/estrategia'
import { avaliarPreco, type EconomiaResolvida } from '../../src/lib/precificacao/cenarios'
import { resolverPrecoEfetivo } from '../../src/lib/precificacao/precos'
import type { Margens } from '../../src/lib/precificacao/margens'
import type { Regra } from '../../src/lib/precificacao/regras'
import type { CampanhaDoAnuncio } from '../../src/lib/precificacao/campanhas'

const AGORA = new Date('2026-09-15T12:00:00Z')
const DAQUI_A_DOIS_DIAS = '2026-09-17T12:00:00Z'
const DAQUI_A_UM_MES = '2026-10-15T12:00:00Z'
const SEMANA_PASSADA = '2026-09-08T12:00:00Z'

// Economia com os DEGRAUS da Fase 1 preservados: faixa de comissão em R$ 80 e
// frete grátis a partir de R$ 79. Os três preços de referência precisam
// respeitá-los, e é isso que este arquivo verifica.
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
  custo: 30,
  pesoKg: 1,
  freteFaixas: null,
}

const regra = (p: Partial<Regra> = {}): Regra => ({
  id: 'r-1', nome: p.nome ?? 'Regra da categoria', nivel: p.nivel ?? 'categoria',
  alvoId: null, alvoTexto: 'Ferramentas', canalId: null,
  objetivoTipo: p.objetivoTipo ?? 'margem_liquida', objetivoValor: p.objetivoValor ?? 20,
  margemMinima: p.margemMinima ?? null,
  margemPromocionalMinima: p.margemPromocionalMinima ?? null,
  arredondamento: p.arredondamento ?? 'nenhum', prioridade: 0,
})

const precos = (preco_venda: number, campanhas?: CampanhaDoAnuncio[]) =>
  resolverPrecoEfetivo({ anuncio: { id: 'a-1', preco_venda }, campanhas, agora: AGORA })

describe('estratégia — a margem alvo é DERIVADA, não lida de coluna', () => {
  test('regra de margem: o alvo é o próprio valor pedido', () => {
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(60), regra: regra({ objetivoTipo: 'margem_liquida', objetivoValor: 20 }), agora: AGORA })
    assert.ok(Math.abs(e.margens.alvo - 20) < 0.1)
  })

  test('regra de MARKUP: o alvo é a margem que aquele markup entrega', () => {
    // É o caso que derruba a premissa de "margem alvo = objetivo_valor".
    // Markup 2,5 sobre custo 30 dá R$ 75 e uma margem líquida de ~34,7% —
    // nada a ver com o número 2,5 guardado na coluna.
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(75), regra: regra({ objetivoTipo: 'markup', objetivoValor: 2.5 }), agora: AGORA })
    assert.equal(e.precoAlvo, 75)
    assert.ok(Math.abs(e.margens.alvo - 34.67) < 0.1, `alvo veio ${e.margens.alvo}`)
    assert.notEqual(e.margens.alvo, 2.5)
  })

  test('regra de lucro fixo: idem', () => {
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(73.75), regra: regra({ objetivoTipo: 'lucro_fixo', objetivoValor: 25 }), agora: AGORA })
    assert.ok(Math.abs(e.margens.alvo - 33.9) < 0.2)
  })

  test('sem regra, não há alvo nem preço alvo', () => {
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(60), regra: null, agora: AGORA })
    assert.equal(e.precoAlvo, 0)
    assert.equal(e.regraAplicada, null)
  })
})

describe('estratégia — os três preços de referência saem do mesmo motor', () => {
  const r = regra({ objetivoTipo: 'margem_liquida', objetivoValor: 25, margemPromocionalMinima: 18, margemMinima: 12 })

  test('cada preço entrega exatamente a margem que lhe corresponde', () => {
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(70), regra: r, agora: AGORA })

    const noAlvo = avaliarPreco(ECONOMIA, e.precoAlvo)
    const noLimite = avaliarPreco(ECONOMIA, e.precoPromocionalLimite!)
    const noPiso = avaliarPreco(ECONOMIA, e.precoPiso!)

    assert.ok(Math.abs(noAlvo.resultado.margemLiquida - 25) < 0.1)
    assert.ok(Math.abs(noLimite.resultado.margemLiquida - 18) < 0.1)
    assert.ok(Math.abs(noPiso.resultado.margemLiquida - 12) < 0.1)
  })

  test('quanto menor a margem exigida, menor o preço', () => {
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(70), regra: r, agora: AGORA })
    assert.ok(e.precoAlvo > e.precoPromocionalLimite!)
    assert.ok(e.precoPromocionalLimite! > e.precoPiso!)
  })

  test('os degraus continuam respeitados nos três preços', () => {
    // Cada preço de referência tem de cair num regime válido — é a garantia
    // de que a Fase 2 não passou a aproximar o que a Fase 1 resolvia exato.
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(70), regra: r, agora: AGORA })
    for (const p of [e.precoAlvo, e.precoPromocionalLimite!, e.precoPiso!]) {
      const c = avaliarPreco(ECONOMIA, p)
      assert.ok(c.resultado.regime, `preço ${p} não pertence a regime nenhum`)
      // Comissão e frete do regime batem com os do cálculo.
      assert.equal(c.resultado.regime!.frete, c.resultado.frete)
    }
  })

  test('sem política promocional, o limite promocional vira o preço do piso', () => {
    const e = montarEstrategia({
      economia: ECONOMIA, precos: precos(70),
      regra: regra({ objetivoValor: 25, margemMinima: 12 }), agora: AGORA,
    })
    assert.equal(e.precoPromocionalLimite, e.precoPiso)
    assert.ok(e.flags.includes('sem_politica_promocional'))
  })

  test('sem piso nem política, não há preço limite nem preço piso', () => {
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(70), regra: regra({ objetivoValor: 25 }), agora: AGORA })
    assert.equal(e.precoPromocionalLimite, null)
    assert.equal(e.precoPiso, null)
  })
})

describe('estratégia — estado e bandeiras', () => {
  const r = regra({ objetivoValor: 25, margemPromocionalMinima: 18, margemMinima: 12 })

  test('sem promoção: estado normal', () => {
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(120), regra: r, agora: AGORA })
    assert.equal(e.estado, 'normal')
    assert.equal(e.origemEfetivo, 'base')
  })

  test('em campanha: estado em_promocao, com a campanha junto', () => {
    const campanhas: CampanhaDoAnuncio[] = [{
      campanha: {
        id: 'c1', empresaId: 'e', canalId: 'ca', plataforma: 'shopee', idExterno: '1',
        nome: 'Setembro', tipo: null, status: 'ativa',
        inicio: SEMANA_PASSADA, fim: DAQUI_A_UM_MES, sincronizadoEm: null, dadosMarketplace: null,
      },
      itens: [{ campanhaId: 'c1', anuncioId: 'a-1', itemIdExterno: '1', modelId: null, status: 'participando' as const,
      precoMinimoMarketplace: null, precoSugeridoMarketplace: null,
      pctMarketplace: null, pctVendedor: null, precoBase: 120, precoCampanha: 99.9, limitePorCompra: null, estoquePromocao: null }],
    }]
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(99.9, campanhas), regra: r, agora: AGORA })
    assert.equal(e.estado, 'em_promocao')
    assert.equal(e.origemEfetivo, 'campanha')
    assert.equal(e.precoEfetivo, 99.9)
    assert.equal(e.precoBase, 120, 'a base vem do preço original da campanha')
    assert.equal(e.campanha?.nome, 'Setembro')
  })

  test('campanha terminando levanta a bandeira e vira oportunidade', () => {
    const campanhas: CampanhaDoAnuncio[] = [{
      campanha: {
        id: 'c1', empresaId: 'e', canalId: 'ca', plataforma: 'shopee', idExterno: '1',
        nome: 'Relâmpago', tipo: null, status: 'ativa',
        inicio: SEMANA_PASSADA, fim: DAQUI_A_DOIS_DIAS, sincronizadoEm: null, dadosMarketplace: null,
      },
      itens: [{ campanhaId: 'c1', anuncioId: 'a-1', itemIdExterno: '1', modelId: null, status: 'participando' as const,
      precoMinimoMarketplace: null, precoSugeridoMarketplace: null,
      pctMarketplace: null, pctVendedor: null, precoBase: 120, precoCampanha: 99.9, limitePorCompra: null, estoquePromocao: null }],
    }]
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(99.9, campanhas), regra: r, agora: AGORA })
    assert.ok(e.flags.includes('promocao_terminando'))
    const op = e.oportunidades.find(o => o.tipo === 'promocao_terminando')
    assert.ok(op, 'campanha terminando precisa virar oportunidade')
    assert.match(op!.detalhe, /volta para/)
  })

  test('preço abaixo do piso: bandeira, classificação e oportunidade crítica', () => {
    // R$ 45 com custo 30: comissão 20% + R$ 4 deixa ~4,4% de margem, bem
    // abaixo do piso de 12%. (R$ 50 cairia EXATAMENTE nos 12% e seria
    // 'requer_aprovacao' — o limite é inclusivo de propósito.)
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(45), regra: r, agora: AGORA })
    assert.equal(e.classificacao.classificacao, 'bloqueado')
    assert.ok(e.flags.includes('abaixo_do_piso'))
    const op = e.oportunidades.find(o => o.tipo === 'abaixo_do_piso')
    assert.equal(op?.severidade, 'critico')
    assert.equal(op?.preco, e.precoPiso)
  })

  test('preço com folga vira oportunidade de promoção, com o preço limite junto', () => {
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(200), regra: r, agora: AGORA })
    const op = e.oportunidades.find(o => o.tipo === 'margem_para_promocao')
    assert.ok(op, 'preço bem acima do limite promocional deveria abrir oportunidade')
    assert.equal(op!.preco, e.precoPromocionalLimite)
    assert.match(op!.detalhe, /desconto/)
  })

  test('divergência de preço vira bandeira de inconsistência', () => {
    const campanhas: CampanhaDoAnuncio[] = [{
      campanha: {
        id: 'c1', empresaId: 'e', canalId: 'ca', plataforma: 'shopee', idExterno: '1',
        nome: 'X', tipo: null, status: 'ativa', inicio: SEMANA_PASSADA, fim: DAQUI_A_UM_MES,
        sincronizadoEm: null, dadosMarketplace: null,
      },
      itens: [{ campanhaId: 'c1', anuncioId: 'a-1', itemIdExterno: '1', modelId: null, status: 'participando' as const,
      precoMinimoMarketplace: null, precoSugeridoMarketplace: null,
      pctMarketplace: null, pctVendedor: null, precoBase: 120, precoCampanha: 99.9, limitePorCompra: null, estoquePromocao: null }],
    }]
    // Espelho em 111, que não é nem a base nem o preço da campanha.
    const e = montarEstrategia({ economia: ECONOMIA, precos: precos(111, campanhas), regra: r, agora: AGORA })
    assert.ok(e.flags.includes('preco_efetivo_inconsistente'))
    assert.ok(e.oportunidades.some(o => o.tipo === 'preco_efetivo_inconsistente'))
  })
})

describe('estratégia — simulador de cenário promocional', () => {
  const MARGENS: Margens = { alvo: 25, promocionalMinima: 18, piso: 12 }

  test('preço candidato informado é avaliado pelo motor e classificado', () => {
    const s = simularCenarioPromocional({ economia: ECONOMIA, margens: MARGENS, precoBase: 120, precoCandidato: 99.9 })
    assert.equal(s.precoCandidato, 99.9)
    assert.equal(s.descontoPercentual, 16.75)
    assert.deepEqual(s.cenario.resultado, avaliarPreco(ECONOMIA, 99.9).resultado)
    assert.ok(['alvo', 'promocional', 'requer_aprovacao', 'bloqueado'].includes(s.classificacao.classificacao))
  })

  test('desconto percentual vira preço UMA vez, e só o preço circula', () => {
    const s = simularCenarioPromocional({ economia: ECONOMIA, margens: MARGENS, precoBase: 100, descontoPercentual: 20 })
    assert.equal(s.precoCandidato, 80)
    assert.equal(s.descontoPercentual, 20)
    // O cenário é o do preço 80 — nenhum percentual sobrou para ser aplicado
    // de novo mais adiante.
    assert.equal(s.cenario.resultado.preco, 80)
  })

  test('o guardrail responde se pode executar', () => {
    const bom = simularCenarioPromocional({ economia: ECONOMIA, margens: MARGENS, precoBase: 200, precoCandidato: 190 })
    const ruim = simularCenarioPromocional({ economia: ECONOMIA, margens: MARGENS, precoBase: 200, precoCandidato: 45 })
    assert.equal(bom.liberado, true)
    assert.equal(ruim.liberado, false)
    assert.equal(ruim.classificacao.classificacao, 'bloqueado')
  })

  test('o desconto atravessando um degrau não é aproximado', () => {
    // De R$ 120 para R$ 78 o item cruza o limite do frete grátis: o frete
    // some e a comissão troca de faixa. A conta precisa refletir os dois.
    const antes = simularCenarioPromocional({ economia: ECONOMIA, margens: MARGENS, precoBase: 120, precoCandidato: 120 })
    const depois = simularCenarioPromocional({ economia: ECONOMIA, margens: MARGENS, precoBase: 120, precoCandidato: 78 })
    assert.equal(antes.cenario.resultado.frete, 22)
    assert.equal(depois.cenario.resultado.frete, 0, 'abaixo de R$ 79 o frete é do comprador')
    assert.equal(antes.cenario.resultado.regime?.comissaoPercentual, 14)
    assert.equal(depois.cenario.resultado.regime?.comissaoPercentual, 20)
  })
})

describe('estratégia — piso inatingível', () => {
  test('quando nenhum preço atinge o piso, não se inventa R$ 0,00', () => {
    // Piso de 95% com comissão de 20% + R$ 4: o motor não fecha e devolve
    // zero com aviso. Zero não é um preço — vira nulo, e a mensagem diz o que
    // realmente aconteceu.
    const e = montarEstrategia({
      economia: ECONOMIA, precos: precos(60),
      regra: regra({ objetivoValor: 25, margemMinima: 95 }), agora: AGORA,
    })
    assert.equal(e.precoPiso, null)
    const op = e.oportunidades.find(o => o.tipo === 'abaixo_do_piso')
    assert.ok(op, 'margem abaixo de um piso de 95% precisa acusar')
    assert.doesNotMatch(op!.detalhe, /R\$ 0,00/)
    assert.match(op!.detalhe, /nenhum preço atinge esse piso/)
  })
})
