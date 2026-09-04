import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// A REGRA DE ADOÇÃO da fila, isolada do Supabase.
//
// A fila só é alimentada por movimentação de estoque ou preço do produto.
// Mapear um anúncio a um produto e vincular uma regra mudam o que DEVERIA
// estar no canal sem tocar em estoque nenhum — e cada uma dessas duas custou
// um dia de investigação, com a tela dizendo "enviando" e nada acontecendo.
//
// O caso real de 04/09/2026: a Pistola Finca Pino (25544) foi vendida ANTES
// de estar mapeada. A fila avaliou, gravou `sem_anuncio` — corretamente, o
// anúncio não existia para ela — e o mapeamento veio depois. A partir dali
// ninguém pediu nada, e o anúncio ficou parado.
//
// A comparação é `anuncio.updated_at > fila.enviado_em`. Ela é o que impede o
// laço infinito, e por isso está travada aqui.

type Recente = Map<string, string>
type NaFila = Map<string, string | null>

/** Espelha `adotarAnunciosAlterados` em fila.ts. */
function decidirAdocao(maisRecente: Recente, ultimoOlhar: NaFila, teto: number): string[] {
  const adotar: string[] = []
  for (const [produtoId, alteradoEm] of maisRecente) {
    if (adotar.length >= teto) break
    const visto = ultimoOlhar.get(produtoId)
    if (!ultimoOlhar.has(produtoId)) adotar.push(produtoId)
    else if (visto && alteradoEm > visto) adotar.push(produtoId)
  }
  return adotar
}

const TETO = 100

describe('adoção de anúncio alterado', () => {
  test('O CASO DA PISTOLA: mapeada depois de a fila ter olhado', () => {
    // A fila olhou às 10h e concluiu `sem_anuncio`. O mapeamento veio às 11h.
    const adotados = decidirAdocao(
      new Map([['p-pistola', '2026-09-04T11:00:00Z']]),
      new Map([['p-pistola', '2026-09-04T10:00:00Z']]),
      TETO,
    )
    assert.deepEqual(adotados, ['p-pistola'])
  })

  test('anúncio inalterado desde a última rodada não volta', () => {
    // É esta linha que impede o laço: depois da rodada, `enviado_em` fica
    // mais novo que `updated_at`.
    const adotados = decidirAdocao(
      new Map([['p1', '2026-09-04T10:00:00Z']]),
      new Map([['p1', '2026-09-04T11:00:00Z']]),
      TETO,
    )
    assert.deepEqual(adotados, [])
  })

  test('produto que nunca esteve na fila é adotado', () => {
    // Anúncio mapeado num produto que nunca vendeu nem foi ajustado: existe,
    // e ninguém nunca pediu nada para ele.
    const adotados = decidirAdocao(
      new Map([['novo', '2026-09-01T00:00:00Z']]),
      new Map(),
      TETO,
    )
    assert.deepEqual(adotados, ['novo'])
  })

  test('produto JÁ pendente não é readotado', () => {
    // `enviado_em` nulo significa pendente. Readotar zeraria as tentativas e
    // faria um anúncio que a plataforma recusa tentar para sempre, por cima
    // do limite de MAX_TENTATIVAS_ENVIO.
    const adotados = decidirAdocao(
      new Map([['p1', '2026-09-04T11:00:00Z']]),
      new Map([['p1', null]]),
      TETO,
    )
    assert.deepEqual(adotados, [])
  })

  test('o teto da rodada é respeitado', () => {
    const muitos: Recente = new Map()
    for (let i = 0; i < 500; i++) muitos.set(`p${i}`, '2026-09-04T11:00:00Z')
    const adotados = decidirAdocao(muitos, new Map(), 10)
    assert.equal(adotados.length, 10)
  })

  test('mesmo instante não conta como alteração', () => {
    // `>` e não `>=`: igual significa que a rodada já viu esta versão.
    const adotados = decidirAdocao(
      new Map([['p1', '2026-09-04T10:00:00Z']]),
      new Map([['p1', '2026-09-04T10:00:00Z']]),
      TETO,
    )
    assert.deepEqual(adotados, [])
  })
})
