import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolverPrecoEfetivo } from '../../src/lib/precificacao/precos'
import {
  vigenciaDaCampanha, proximidadeDoFim, itemDoAnuncio, normalizarCampanhaDoEspelho,
  type CampanhaCanonica, type CampanhaDoAnuncio, type ItemCampanha,
} from '../../src/lib/precificacao/campanhas'

const AGORA = new Date('2026-09-15T12:00:00Z')
const ONTEM = '2026-09-14T12:00:00Z'
const AMANHA = '2026-09-16T12:00:00Z'
const SEMANA_PASSADA = '2026-09-08T12:00:00Z'
const DAQUI_A_UM_MES = '2026-10-15T12:00:00Z'
const DAQUI_A_CINCO_DIAS = '2026-09-20T12:00:00Z'

const ANUNCIO_ID = 'anuncio-1'

function campanha(p: Partial<CampanhaCanonica> = {}): CampanhaCanonica {
  return {
    id: p.id ?? 'camp-1', empresaId: 'emp-1', canalId: 'canal-1', plataforma: p.plataforma ?? 'shopee',
    idExterno: p.idExterno ?? '9001', nome: p.nome ?? 'Campanha de Setembro', tipo: null,
    status: p.status ?? 'ativa',
    inicio: p.inicio !== undefined ? p.inicio : SEMANA_PASSADA,
    fim: p.fim !== undefined ? p.fim : DAQUI_A_UM_MES,
    sincronizadoEm: ONTEM, dadosMarketplace: null,
  }
}

function item(p: Partial<ItemCampanha> = {}): ItemCampanha {
  return {
    campanhaId: 'camp-1', anuncioId: p.anuncioId !== undefined ? p.anuncioId : ANUNCIO_ID,
    itemIdExterno: p.itemIdExterno ?? '123', modelId: p.modelId ?? null,
    precoBase: p.precoBase !== undefined ? p.precoBase : 74.90,
    precoCampanha: p.precoCampanha !== undefined ? p.precoCampanha : 59.90,
    limitePorCompra: null, estoquePromocao: null,
  }
}

const comCampanha = (c: Partial<CampanhaCanonica> = {}, itens = [item()]): CampanhaDoAnuncio[] =>
  [{ campanha: campanha(c), itens }]

describe('vigência da campanha', () => {
  test('ativa e dentro da janela vale', () => {
    const v = vigenciaDaCampanha(campanha(), AGORA)
    assert.equal(v.vigente, true)
    assert.ok(v.restaMs! > 0)
  })

  test('ainda não começou não vale', () => {
    const v = vigenciaDaCampanha(campanha({ inicio: AMANHA }), AGORA)
    assert.equal(v.vigente, false)
    assert.match(v.motivo!, /ainda não começou/)
  })

  test('janela terminada não vale', () => {
    const v = vigenciaDaCampanha(campanha({ fim: ONTEM }), AGORA)
    assert.equal(v.vigente, false)
    assert.match(v.motivo!, /já terminou/)
  })

  test('encerrada na plataforma não vale, mesmo dentro da janela', () => {
    const v = vigenciaDaCampanha(campanha({ status: 'encerrada' }), AGORA)
    assert.equal(v.vigente, false)
  })

  test('rascunho não vale', () => {
    assert.equal(vigenciaDaCampanha(campanha({ status: 'rascunho' }), AGORA).vigente, false)
  })

  test('a JANELA manda sobre o status: "programada" já começada vale, com aviso', () => {
    // O sync de campanhas é manual neste sistema; o status é retrato velho e
    // a janela é fato datado.
    const v = vigenciaDaCampanha(campanha({ status: 'programada' }), AGORA)
    assert.equal(v.vigente, true)
    assert.ok(v.avisos.some(a => a.includes('atrasado')))
  })

  test('sem fim declarado, vale por prazo indeterminado', () => {
    const v = vigenciaDaCampanha(campanha({ fim: null }), AGORA)
    assert.equal(v.vigente, true)
    assert.equal(v.restaMs, null)
  })
})

describe('proximidade do fim', () => {
  const dias = (n: number) => n * 86_400_000
  test('classifica o quanto falta', () => {
    assert.equal(proximidadeDoFim(dias(30)).estado, 'ativa')
    assert.equal(proximidadeDoFim(dias(5)).estado, 'termina_em_7_dias')
    assert.equal(proximidadeDoFim(dias(2)).estado, 'termina_em_3_dias')
    assert.equal(proximidadeDoFim(dias(0.5)).estado, 'termina_hoje')
    assert.equal(proximidadeDoFim(-1).estado, 'expirada')
    assert.equal(proximidadeDoFim(null).estado, 'sem_prazo')
  })

  test('os limites são configuráveis, não hardcoded na tela', () => {
    assert.equal(proximidadeDoFim(dias(10), { atencao: 15, urgente: 5 }).estado, 'termina_em_7_dias')
  })
})

describe('item da campanha para o anúncio', () => {
  test('um item só resolve direto', () => {
    const { item: achado, aviso } = itemDoAnuncio([item()], ANUNCIO_ID)
    assert.equal(achado?.precoCampanha, 59.90)
    assert.equal(aviso, null)
  })

  test('variações com o MESMO preço resolvem', () => {
    const r = itemDoAnuncio([item({ modelId: 'm1' }), item({ modelId: 'm2' })], ANUNCIO_ID)
    assert.equal(r.item?.precoCampanha, 59.90)
    assert.equal(r.aviso, null)
  })

  test('variações com preços DIFERENTES não resolvem — e dizem por quê', () => {
    const r = itemDoAnuncio(
      [item({ modelId: 'm1', precoCampanha: 59.90 }), item({ modelId: 'm2', precoCampanha: 49.90 })],
      ANUNCIO_ID,
    )
    assert.equal(r.item, null)
    assert.match(r.aviso!, /variações/)
  })

  test('item de outro anúncio é ignorado', () => {
    assert.equal(itemDoAnuncio([item({ anuncioId: 'outro' })], ANUNCIO_ID).item, null)
  })
})

describe('preço efetivo — precedência', () => {
  test('sem campanha nem promoção local, vale o espelho', () => {
    const r = resolverPrecoEfetivo({ anuncio: { id: ANUNCIO_ID, preco_venda: 74.90 }, agora: AGORA })
    assert.equal(r.efetivo, 74.90)
    assert.equal(r.origemEfetivo, 'base')
    assert.equal(r.campanha, null)
  })

  test('promoção local vigente ganha do espelho', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90, preco_promocional: 64.90, promo_fim: AMANHA },
      agora: AGORA,
    })
    assert.equal(r.efetivo, 64.90)
    assert.equal(r.origemEfetivo, 'promocional_local')
  })

  test('CAMPANHA REAL ganha da promoção local', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90, preco_promocional: 64.90, promo_fim: AMANHA },
      campanhas: comCampanha(), agora: AGORA,
    })
    assert.equal(r.efetivo, 59.90)
    assert.equal(r.origemEfetivo, 'campanha')
    assert.ok(r.avisos.some(a => a.includes('promoção local')))
  })

  test('campanha expirada não muda o preço efetivo', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90 },
      campanhas: comCampanha({ fim: ONTEM }), agora: AGORA,
    })
    assert.equal(r.efetivo, 74.90)
    assert.equal(r.origemEfetivo, 'base')
  })

  test('campanha futura não muda o preço efetivo', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90 },
      campanhas: comCampanha({ inicio: AMANHA, fim: DAQUI_A_UM_MES }), agora: AGORA,
    })
    assert.equal(r.efetivo, 74.90)
  })

  test('campanha cancelada/encerrada não muda o preço efetivo', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90 },
      campanhas: comCampanha({ status: 'encerrada' }), agora: AGORA,
    })
    assert.equal(r.efetivo, 74.90)
  })

  test('campanha sem preço não muda nada', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90 },
      campanhas: comCampanha({}, [item({ precoCampanha: null })]), agora: AGORA,
    })
    assert.equal(r.efetivo, 74.90)
  })

  test('duas campanhas vigentes: vale a mais barata, com aviso', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90 },
      campanhas: [
        { campanha: campanha({ id: 'c1', nome: 'A' }), itens: [item({ campanhaId: 'c1', precoCampanha: 59.90 })] },
        { campanha: campanha({ id: 'c2', nome: 'B' }), itens: [item({ campanhaId: 'c2', precoCampanha: 54.90 })] },
      ],
      agora: AGORA,
    })
    assert.equal(r.efetivo, 54.90)
    assert.ok(r.avisos.some(a => a.includes('2 campanhas')))
  })
})

describe('preço efetivo — SHOPEE, e a armadilha do desconto duplo', () => {
  // `preco_venda` da Shopee recebe `current_price`, que JÁ tem o desconto da
  // campanha aplicado. O erro que estes testes existem para impedir é tratar
  // esse valor como preço estrutural e descontar de novo por cima.
  test('espelho já descontado + campanha: o preço efetivo NÃO desce duas vezes', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 59.90 }, // current_price, já com desconto
      campanhas: comCampanha({}, [item({ precoBase: 74.90, precoCampanha: 59.90 })]),
      agora: AGORA,
    })
    assert.equal(r.efetivo, 59.90, 'o efetivo é o preço da campanha, lido — não calculado')
    assert.notEqual(r.efetivo, 59.90 * 0.8)
    assert.notEqual(r.efetivo, 74.90 * 0.8 * 0.8)
  })

  test('a campanha RECUPERA o preço base que o espelho não guarda', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 59.90 },
      campanhas: comCampanha({}, [item({ precoBase: 74.90, precoCampanha: 59.90 })]),
      agora: AGORA,
    })
    assert.equal(r.base, 74.90, 'preco_original da campanha é o preço estrutural')
    assert.equal(r.origemBase, 'campanha')
  })

  test('sem preço original na campanha, a base continua sendo o espelho', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 59.90 },
      campanhas: comCampanha({}, [item({ precoBase: null, precoCampanha: 59.90 })]),
      agora: AGORA,
    })
    assert.equal(r.base, 59.90)
    assert.equal(r.origemBase, 'espelho')
  })

  test('espelho que não bate com campanha nem com o original vira AVISO', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 65.00 },
      campanhas: comCampanha({}, [item({ precoBase: 74.90, precoCampanha: 59.90 })]),
      agora: AGORA,
    })
    assert.equal(r.efetivo, 59.90)
    assert.ok(r.avisos.some(a => a.includes('não bate')), 'divergência entre espelho e campanha precisa aparecer')
  })

  test('espelho igual ao preço original não gera aviso — os dois concordam', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90 },
      campanhas: comCampanha({}, [item({ precoBase: 74.90, precoCampanha: 59.90 })]),
      agora: AGORA,
    })
    assert.equal(r.avisos.filter(a => a.includes('não bate')).length, 0)
  })

  test('nenhum percentual é aplicado em lugar nenhum', () => {
    // Prova por varredura: para qualquer combinação, o efetivo é sempre um
    // dos números LIDOS, nunca um produto deles.
    for (const espelho of [40, 59.9, 74.9, 100]) {
      for (const promo of [49.9, 59.9]) {
        const r = resolverPrecoEfetivo({
          anuncio: { id: ANUNCIO_ID, preco_venda: espelho },
          campanhas: comCampanha({}, [item({ precoBase: 74.90, precoCampanha: promo })]),
          agora: AGORA,
        })
        assert.ok(
          [espelho, promo, 74.90].includes(r.efetivo),
          `efetivo ${r.efetivo} não é nenhum dos preços lidos (${espelho}, ${promo}, 74.9)`,
        )
      }
    }
  })
})

describe('preço efetivo — validade e proximidade', () => {
  test('campanha vigente informa até quando vale e quanto falta', () => {
    const r = resolverPrecoEfetivo({
      anuncio: { id: ANUNCIO_ID, preco_venda: 74.90 },
      campanhas: comCampanha({ fim: DAQUI_A_CINCO_DIAS }), agora: AGORA,
    })
    assert.equal(r.validadeAte, DAQUI_A_CINCO_DIAS)
    assert.equal(r.campanha?.proximidade, 'termina_em_7_dias')
    assert.equal(r.campanha?.diasRestantes, 5)
  })
})

describe('normalização do espelho da Shopee', () => {
  test('linha do banco vira modelo canônico, com plataforma vinda do canal', () => {
    const { campanha: c, itens } = normalizarCampanhaDoEspelho(
      {
        id: 'camp-x', id_externo: '777', nome: 'Setembro', status: 'ativa',
        inicio: SEMANA_PASSADA, fim: DAQUI_A_UM_MES, sincronizado_em: ONTEM,
        marketplace_promocao_itens: [
          { anuncio_id: ANUNCIO_ID, item_id_externo: '123', model_id: null, preco_original: '74.90', preco_promocional: '59.90', limite_por_compra: 2, estoque_promocao: 10 },
        ],
      },
      { id: 'canal-1', plataforma: 'shopee' }, 'emp-1',
    )
    assert.equal(c.plataforma, 'shopee', 'a tabela não tem coluna de plataforma; ela vem do canal')
    assert.equal(c.idExterno, '777')
    assert.equal(c.status, 'ativa')
    assert.equal(itens.length, 1)
    assert.equal(itens[0].precoBase, 74.90)
    assert.equal(itens[0].precoCampanha, 59.90)
    assert.equal(itens[0].limitePorCompra, 2)
  })

  test('status desconhecido não vira "ativa" por acidente', () => {
    const { campanha: c } = normalizarCampanhaDoEspelho(
      { id: 'x', status: 'sei_la', marketplace_promocao_itens: [] },
      { id: 'canal-1', plataforma: 'shopee' }, 'emp-1',
    )
    assert.equal(c.status, 'rascunho')
  })

  test('preço zero ou negativo no espelho não vira preço de campanha', () => {
    const { itens } = normalizarCampanhaDoEspelho(
      {
        id: 'x', status: 'ativa',
        marketplace_promocao_itens: [{ anuncio_id: ANUNCIO_ID, item_id_externo: '1', preco_original: 0, preco_promocional: -5 }],
      },
      { id: 'canal-1', plataforma: 'shopee' }, 'emp-1',
    )
    assert.equal(itens[0].precoBase, null)
    assert.equal(itens[0].precoCampanha, null)
  })
})
