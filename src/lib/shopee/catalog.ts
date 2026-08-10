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

// Limite de 50 item_id por chamada confirmado no schema do endpoint (fonte
// secundária, mas explícito — "item_id list, limit [0,50]" — diferente do
// resto deste arquivo, que usa valores conservadores por falta de confirmação).
export const EXTRA_INFO_BATCH_SIZE = 50

// get_item_extra_info: métricas que get_item_base_info não traz (vendas,
// visualizações, curtidas, avaliação, comentários). Chamada separada porque
// é um endpoint diferente — não dá pra pedir junto do base info.
export async function getItemExtraInfoBatch(ctx: CallCtx, itemIds: number[]): Promise<any[]> {
  const callOptions = await callOpts(ctx)
  const resultados: any[] = []

  for (let i = 0; i < itemIds.length; i += EXTRA_INFO_BATCH_SIZE) {
    const lote = itemIds.slice(i, i + EXTRA_INFO_BATCH_SIZE)
    const data = await shopeeGet(
      '/api/v2/product/get_item_extra_info',
      { item_id_list: lote.join(',') },
      callOptions
    )
    resultados.push(...(data?.response?.item_list ?? []))
    await sleep(THROTTLE_MS)
  }

  return resultados
}

type CallCtx = { sb: any; canal: ShopeeChannel }

async function callOpts(ctx: CallCtx) {
  const { partnerId, partnerKey } = await getIntegracaoCredentials(ctx.sb)
  return { partnerId, partnerKey, accessToken: ctx.canal.accessToken, shopId: ctx.canal.sellerId }
}

// Gera páginas de item_id conforme a paginação da Shopee (offset + page_size).
// Defensivo: se `has_next_page`/`next_offset` não vierem na resposta, para
// quando a página trouxer menos itens que o solicitado.
export type ShopeeCursor = { statusIdx: number; offset: number }

export async function* listItemIds(
  ctx: CallCtx,
  opts: { pageSize?: number; cursorInicial?: ShopeeCursor | null } = {}
): AsyncGenerator<{ itens: { itemId: number; itemStatus: string }[]; cursor: ShopeeCursor | null }> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const callOptions = await callOpts(ctx)

  // Retomada: começa do status/offset onde a rodada anterior parou. Sem isto
  // a varredura sempre recomeçava do offset 0 e, com o teto de itens por
  // rodada, nunca passava dos primeiros 500 anúncios — os outros ~8.000
  // nunca eram atualizados por ninguém.
  const inicio = opts.cursorInicial ?? { statusIdx: 0, offset: 0 }

  for (let statusIdx = inicio.statusIdx; statusIdx < STATUSES_TO_SYNC.length; statusIdx++) {
    const itemStatus = STATUSES_TO_SYNC[statusIdx]
    let offset = statusIdx === inicio.statusIdx ? inicio.offset : 0
    while (true) {
      const data = await shopeeGet(
        '/api/v2/product/get_item_list',
        { offset, page_size: pageSize, item_status: itemStatus },
        callOptions
      )
      const items: { item_id: number; item_status?: string }[] = data?.response?.item ?? []
      if (items.length === 0) break

      const hasNext = data?.response?.has_next_page
      const nextOffset = data?.response?.next_offset

      // Onde continuar DEPOIS desta página. `null` significa "acabou o
      // catálogo inteiro" — o que só é verdade no último status.
      let proximo: ShopeeCursor | null
      let fimDoStatus = false
      if (typeof hasNext === 'boolean') {
        fimDoStatus = !hasNext
        proximo = { statusIdx, offset: typeof nextOffset === 'number' ? nextOffset : offset + items.length }
      } else {
        // Resposta sem indicação de paginação — fallback defensivo.
        fimDoStatus = items.length < pageSize
        proximo = { statusIdx, offset: offset + items.length }
      }
      if (fimDoStatus) {
        proximo = statusIdx + 1 < STATUSES_TO_SYNC.length ? { statusIdx: statusIdx + 1, offset: 0 } : null
      }

      yield {
        itens: items.map(i => ({ itemId: i.item_id, itemStatus: i.item_status ?? itemStatus })),
        cursor: proximo,
      }

      await sleep(THROTTLE_MS)

      if (fimDoStatus) break
      offset = proximo!.offset
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
