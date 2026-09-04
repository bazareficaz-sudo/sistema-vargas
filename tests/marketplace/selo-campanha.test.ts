import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { selosDoAnuncio, selosPorAnuncio, seloDaCampanha, textoDoSelo, explicarSelo } from '../../src/lib/marketplace/seloCampanha'
import type { CampanhaDoAnuncio } from '../../src/lib/precificacao/campanhas'

// O SELO DE CAMPANHA responde "este anúncio está comprometido", que é
// pergunta diferente de "qual preço vale agora". Os dois casos que motivaram
// o módulo estão travados aqui: campanha PROGRAMADA e variações com preços
// diferentes — os dois em que `resolverPrecoEfetivo` cala, com razão.

const AGORA = new Date('2026-09-04T12:00:00Z')

function campanha(over: Partial<CampanhaDoAnuncio['campanha']> = {}, itens: Partial<CampanhaDoAnuncio['itens'][number]>[] = []): CampanhaDoAnuncio {
  return {
    campanha: {
      id: 'c1', empresaId: 'e1', canalId: 'k1', plataforma: 'shopee',
      idExterno: '1207838242246709', nome: 'Bota Fora', tipo: null,
      status: 'ativa',
      inicio: '2026-09-01T00:00:00Z',
      fim: '2026-10-31T23:59:59Z',
      sincronizadoEm: '2026-09-04T09:00:00Z',
      dadosMarketplace: null,
      ...over,
    },
    itens: itens.map((i) => ({
      campanhaId: 'c1', anuncioId: 'a1', itemIdExterno: '58257952255',
      modelId: null, status: 'participando' as const,
      precoBase: 24.9, precoCampanha: 22.41,
      precoMinimoMarketplace: null, precoSugeridoMarketplace: null,
      pctMarketplace: null, pctVendedor: null,
      limitePorCompra: null, estoquePromocao: null,
      ...i,
    })),
  }
}

describe('selo de campanha', () => {
  test('campanha valendo diz quantos dias faltam', () => {
    const [s] = selosDoAnuncio([campanha({}, [{}])], 'a1', AGORA)
    assert.equal(s.estado, 'valendo')
    // 04/09 12:00 até 31/10 23:59 são 57 dias cheios.
    assert.equal(s.diasRestantes, 57)
    assert.equal(textoDoSelo(s), '57d')
  })

  test('anúncio fora da campanha não ganha selo', () => {
    assert.equal(selosDoAnuncio([campanha({}, [{}])], 'outro', AGORA).length, 0)
  })

  test('CONVITE não é compromisso: item candidato não vira selo', () => {
    const c = campanha({}, [{ status: 'candidato' }])
    assert.equal(seloDaCampanha(c, 'a1', AGORA), null)
  })

  test('campanha PROGRAMADA aparece — é onde a margem de segurança se decide', () => {
    // O caso que `resolverPrecoEfetivo` descarta com razão: a janela não abriu,
    // então ela não manda em preço. Mas o preço da campanha já está fechado.
    const c = campanha({
      status: 'programada',
      inicio: '2026-09-10T00:00:00Z',
      fim: '2026-09-20T00:00:00Z',
    }, [{ precoCampanha: 19.9 }])
    const [s] = selosDoAnuncio([c], 'a1', AGORA)
    assert.equal(s.estado, 'programada')
    assert.equal(s.diasParaComecar, 6)
    assert.equal(textoDoSelo(s), 'começa em 6d')
    assert.match(explicarSelo(s), /NÃO muda o da campanha/)
  })

  test('janela vencida com espelho desatualizado não se disfarça de ativa', () => {
    const c = campanha({ status: 'ativa', fim: '2026-08-30T00:00:00Z' }, [{}])
    const [s] = selosDoAnuncio([c], 'a1', AGORA)
    assert.equal(s.estado, 'expirada')
    assert.equal(textoDoSelo(s), 'janela vencida')
  })

  test('encerrada e rascunho não geram selo', () => {
    for (const status of ['encerrada', 'rascunho'] as const) {
      assert.equal(seloDaCampanha(campanha({ status }, [{}]), 'a1', AGORA), null)
    }
  })

  test('VARIAÇÕES com preços diferentes: o selo dá a faixa em vez de calar', () => {
    // A tesoura real da "Bota Fora": dois model_id, R$ 22,41 e R$ 19,62.
    // `itemDoAnuncio` devolve nulo aqui, e por isso a precificação mostrava
    // este anúncio como se campanha nenhuma existisse.
    const c = campanha({}, [
      { modelId: '10001', precoCampanha: 22.41 },
      { modelId: '10002', precoCampanha: 19.62 },
    ])
    const [s] = selosDoAnuncio([c], 'a1', AGORA)
    assert.equal(s.itens, 2)
    assert.equal(s.precoPorVariacao, true)
    assert.equal(s.precoDe, 19.62)
    assert.equal(s.precoAte, 22.41)
    assert.match(explicarSelo(s), /2 variações, preços diferentes/)
  })

  test('variações com o MESMO preço não são anunciadas como faixa', () => {
    const c = campanha({}, [
      { modelId: '10001', precoCampanha: 22.41 },
      { modelId: '10002', precoCampanha: 22.41 },
    ])
    const [s] = selosDoAnuncio([c], 'a1', AGORA)
    assert.equal(s.precoPorVariacao, false)
    assert.match(explicarSelo(s), /mesmo preço/)
  })

  test('espelho velho é declarado, não escondido', () => {
    const recente = seloDaCampanha(campanha({}, [{}]), 'a1', AGORA)!
    assert.equal(recente.espelhoVelho, false)

    const velho = seloDaCampanha(
      campanha({ sincronizadoEm: '2026-08-28T09:00:00Z' }, [{}]), 'a1', AGORA)!
    assert.equal(velho.espelhoVelho, true)
    assert.match(explicarSelo(velho), /faz mais de um dia/)
  })

  test('sem data de sincronização o selo confessa que pode estar velho', () => {
    const s = seloDaCampanha(campanha({ sincronizadoEm: null }, [{}]), 'a1', AGORA)!
    assert.equal(s.espelhoVelho, false)
    assert.match(explicarSelo(s), /Sem data de sincronização/)
  })

  test('duas campanhas: o que está no ar vem antes do que ainda vai entrar', () => {
    const programada = campanha({
      id: 'c2', nome: 'Setembro', status: 'programada',
      inicio: '2026-09-10T00:00:00Z', fim: '2026-09-20T00:00:00Z',
    }, [{ campanhaId: 'c2' }])
    const ativa = campanha({}, [{}])
    const selos = selosDoAnuncio([programada, ativa], 'a1', AGORA)
    assert.equal(selos.length, 2)
    assert.equal(selos[0].estado, 'valendo')
    assert.equal(selos[1].estado, 'programada')
  })

  test('termina hoje ganha texto próprio, porque é decisão de hoje', () => {
    const c = campanha({ fim: '2026-09-04T20:00:00Z' }, [{}])
    const [s] = selosDoAnuncio([c], 'a1', AGORA)
    assert.equal(s.proximidade, 'termina_hoje')
    assert.equal(textoDoSelo(s), 'termina hoje')
  })

  test('item sem preço de campanha não vira selo', () => {
    assert.equal(seloDaCampanha(campanha({}, [{ precoCampanha: null }]), 'a1', AGORA), null)
  })
})

describe('selosPorAnuncio — uma passada só', () => {
  test('agrupa por anúncio e dá o mesmo resultado que anúncio a anúncio', () => {
    const c = campanha({}, [
      { anuncioId: 'a1', modelId: '10001', precoCampanha: 22.41 },
      { anuncioId: 'a1', modelId: '10002', precoCampanha: 19.62 },
      { anuncioId: 'a2', precoCampanha: 30 },
      { anuncioId: null, precoCampanha: 40 },
      { anuncioId: 'a3', status: 'candidato' },
    ])
    const mapa = selosPorAnuncio([c], AGORA)

    assert.deepEqual(Object.keys(mapa).sort(), ['a1', 'a2'])
    assert.equal(mapa.a1[0].itens, 2)
    assert.equal(mapa.a1[0].precoDe, 19.62)
    assert.deepEqual(mapa.a1, selosDoAnuncio([c], 'a1', AGORA))
    assert.deepEqual(mapa.a2, selosDoAnuncio([c], 'a2', AGORA))
    // Item sem anúncio vinculado e convidado ficam de fora, como no unitário.
    assert.equal(mapa.a3, undefined)
  })

  test('anúncio em duas campanhas mantém a ordem de urgência', () => {
    const programada = campanha({
      id: 'c2', nome: 'Setembro', status: 'programada',
      inicio: '2026-09-10T00:00:00Z', fim: '2026-09-20T00:00:00Z',
    }, [{ campanhaId: 'c2' }])
    const ativa = campanha({}, [{}])
    const mapa = selosPorAnuncio([programada, ativa], AGORA)
    assert.equal(mapa.a1.length, 2)
    assert.equal(mapa.a1[0].estado, 'valendo')
    assert.equal(mapa.a1[1].estado, 'programada')
  })
})
