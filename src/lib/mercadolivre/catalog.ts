import { mlGet } from './client'
import type { MLChannel } from './types'

// Valores conservadores — diferente da Shopee (cruzada contra um SDK de
// terceiro), aqui não houve essa validação cruzada. Confiança moderada:
// formato de paginação e multiget batem com o padrão público e conhecido da
// API do Mercado Livre, mas vale conferir contra `dados_brutos` na primeira
// sincronização real e ajustar se algo vier diferente do esperado.
export const DEFAULT_PAGE_SIZE = 50
export const ITEMS_BATCH_SIZE = 20
export const THROTTLE_MS = 150

// A busca padrão de /items/search (offset) é limitada pelo próprio ML a
// offset+limit <= 1000 — catálogos maiores exigiriam o modo "scan" com
// scroll_id, não implementado aqui. Lojas com mais de 1000 anúncios ativos
// ficam truncadas (mesmo aviso que já existe pro limite de itens por rodada).
const OFFSET_MAX = 1000

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type CallCtx = { sb: any; canal: MLChannel }

export async function* listItemIds(ctx: CallCtx, opts: { pageSize?: number } = {}): AsyncGenerator<string[]> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  let offset = 0
  while (true) {
    const data = await mlGet(`/users/${ctx.canal.sellerId}/items/search`, { offset, limit: pageSize }, ctx.canal.accessToken)
    const ids: string[] = data?.results ?? []
    if (ids.length === 0) break

    yield ids
    await sleep(THROTTLE_MS)

    const total = data?.paging?.total ?? 0
    offset += ids.length
    if (offset >= total || offset >= OFFSET_MAX) break
  }
}

// Multiget de detalhes — até 20 IDs por chamada (limite conhecido do
// endpoint /items). Itens não encontrados/sem permissão vêm com
// code !== 200 na resposta e são descartados aqui.
export async function getItemsBatch(ctx: CallCtx, itemIds: string[]): Promise<any[]> {
  const resultados: any[] = []

  for (let i = 0; i < itemIds.length; i += ITEMS_BATCH_SIZE) {
    const lote = itemIds.slice(i, i + ITEMS_BATCH_SIZE)
    const data = await mlGet('/items', { ids: lote.join(',') }, ctx.canal.accessToken)
    const entradas: any[] = Array.isArray(data) ? data : []
    for (const entrada of entradas) {
      if (entrada?.code === 200 && entrada?.body) resultados.push(entrada.body)
    }
    await sleep(THROTTLE_MS)
  }

  return resultados
}
