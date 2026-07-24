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

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type CallCtx = { sb: any; canal: MLChannel }

// Pagina via "scan" (scroll_id), não offset — a busca por offset é limitada
// pelo próprio ML a offset+limit <= 1000, o que truncava silenciosamente
// qualquer loja com catálogo maior (confirmado ao vivo: uma conta real com
// 5.449 itens ativos nunca conseguia ir além dos primeiros ~500, sempre os
// MESMOS, porque cada sincronização recomeçava do offset 0). Scan não tem
// esse teto: cada resposta traz um `scroll_id` novo pra buscar a próxima
// leva, até vir vazio — validado ao vivo contra a API real do Mercado Livre.
// `scrollIdInicial` permite RETOMAR de onde uma sincronização anterior
// parou (ver syncCatalogo), em vez de sempre recomeçar do zero.
export async function* listItemIdsScan(
  ctx: CallCtx,
  opts: { pageSize?: number; scrollIdInicial?: string | null } = {}
): AsyncGenerator<{ ids: string[]; scrollId: string | null }> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  let scrollId = opts.scrollIdInicial ?? undefined

  while (true) {
    const params: Record<string, any> = { search_type: 'scan', limit: pageSize }
    if (scrollId) params.scroll_id = scrollId
    const data = await mlGet(`/users/${ctx.canal.sellerId}/items/search`, params, ctx.canal.accessToken)
    const ids: string[] = data?.results ?? []
    scrollId = data?.scroll_id ?? undefined

    if (ids.length === 0) break
    yield { ids, scrollId: scrollId ?? null }
    await sleep(THROTTLE_MS)
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
