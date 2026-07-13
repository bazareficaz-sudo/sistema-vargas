import { shopeeGet, getIntegracaoCredentials } from './client'
import type { ShopeeChannel } from './types'

// Valores conservadores — detalhes exatos (limite real de lote/página) não
// confirmados contra a documentação oficial no momento da implementação.
// Ver "Limitações conhecidas" no plano. Ajustar aqui depois de validar com
// respostas reais da API (gravadas em dados_brutos).
export const DEFAULT_PAGE_SIZE = 20
export const BASE_INFO_BATCH_SIZE = 20
export const THROTTLE_MS = 150

// Shopee exige item_status por chamada — cobre ativos e pausados. BANNED/
// DELETED ficam de fora propositalmente (não interessam para um sync de
// catálogo comercial).
const STATUSES_TO_SYNC = ['NORMAL', 'UNLIST']

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type CallCtx = { sb: any; canal: ShopeeChannel }

async function callOpts(ctx: CallCtx) {
  const { partnerId, partnerKey } = await getIntegracaoCredentials(ctx.sb)
  return { partnerId, partnerKey, accessToken: ctx.canal.accessToken, shopId: ctx.canal.sellerId }
}

// Gera páginas de item_id conforme a paginação da Shopee (offset + page_size).
// Defensivo: se `has_next_page`/`next_offset` não vierem na resposta, para
// quando a página trouxer menos itens que o solicitado.
export async function* listItemIds(
  ctx: CallCtx,
  opts: { pageSize?: number } = {}
): AsyncGenerator<{ itemId: number; itemStatus: string }[]> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const callOptions = await callOpts(ctx)

  for (const itemStatus of STATUSES_TO_SYNC) {
    let offset = 0
    while (true) {
      const data = await shopeeGet(
        '/api/v2/product/get_item_list',
        { offset, page_size: pageSize, item_status: itemStatus },
        callOptions
      )
      const items: { item_id: number; item_status?: string }[] = data?.response?.item ?? []
      if (items.length === 0) break

      yield items.map(i => ({ itemId: i.item_id, itemStatus: i.item_status ?? itemStatus }))

      const hasNext = data?.response?.has_next_page
      const nextOffset = data?.response?.next_offset
      await sleep(THROTTLE_MS)

      if (typeof hasNext === 'boolean') {
        if (!hasNext) break
        offset = typeof nextOffset === 'number' ? nextOffset : offset + items.length
      } else {
        // Resposta sem indicação de paginação — fallback defensivo.
        if (items.length < pageSize) break
        offset += items.length
      }
    }
  }
}

export async function getItemBaseInfoBatch(ctx: CallCtx, itemIds: number[]): Promise<any[]> {
  const callOptions = await callOpts(ctx)
  const resultados: any[] = []

  for (let i = 0; i < itemIds.length; i += BASE_INFO_BATCH_SIZE) {
    const lote = itemIds.slice(i, i + BASE_INFO_BATCH_SIZE)
    const data = await shopeeGet(
      '/api/v2/product/get_item_base_info',
      { item_id_list: lote.join(','), need_tax_info: 'false', need_complaint_policy: 'false' },
      callOptions
    )
    resultados.push(...(data?.response?.item_list ?? []))
    await sleep(THROTTLE_MS)
  }

  return resultados
}

export async function getModelList(ctx: CallCtx, itemId: number): Promise<any> {
  const callOptions = await callOpts(ctx)
  const data = await shopeeGet('/api/v2/product/get_model_list', { item_id: itemId }, callOptions)
  await sleep(THROTTLE_MS)
  return data?.response ?? null
}
