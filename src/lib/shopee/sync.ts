import { getIntegracaoCredentials, refreshAccessTokenIfNeeded, shopeeGet } from './client'
import { getItemBaseInfoBatch, getModelList, listItemIds } from './catalog'
import type { ShopeeChannel, SyncFailure, SyncResult } from './types'

// Teto de itens processados por chamada de sincronização — não existe fila/
// cron nesta fase, então a sincronização é síncrona e limitada. Lojas com
// catálogos maiores que isso precisam rodar "Sincronizar agora" mais de uma
// vez (o resultado sinaliza `truncated: true` quando isso acontece).
const DEFAULT_MAX_ITEMS = 500

const STATUS_MAP: Record<string, string> = {
  NORMAL: 'ativo',
  UNLIST: 'pausado',
  BANNED: 'erro',
  DELETED: 'encerrado',
}
function mapStatus(itemStatus?: string) {
  return STATUS_MAP[itemStatus ?? ''] ?? 'rascunho'
}

// Mapeia o item bruto da Shopee para a linha de marketplace_anuncios.
// Deliberadamente defensivo: campos ausentes viram warnings, não exceções —
// dados_brutos guarda o payload completo para conferência/ajuste posterior.
export function mapItemToAnuncioRow(rawItem: any, canal: ShopeeChannel): { row: Record<string, any>; warnings: string[] } {
  const warnings: string[] = []

  const precoInfo = rawItem.price_info?.[0]
  if (!precoInfo) warnings.push('price_info ausente na resposta')
  const preco = Number(precoInfo?.current_price ?? precoInfo?.original_price ?? 0)

  const estoque = rawItem.stock_info_v2?.summary_info?.total_available_stock
  if (estoque === undefined) warnings.push('stock_info_v2 ausente na resposta')

  const row = {
    empresa_id: canal.empresaId,
    canal_id: canal.id,
    titulo: rawItem.item_name ?? `Item ${rawItem.item_id}`,
    descricao: rawItem.description ?? null,
    preco_venda: preco,
    id_externo: String(rawItem.item_id),
    sku_canal: rawItem.item_sku ?? null,
    status: mapStatus(rawItem.item_status),
    status_externo: rawItem.item_status ?? null,
    estoque_externo: typeof estoque === 'number' ? estoque : null,
    estoque_reservado: typeof estoque === 'number' ? estoque : 0,
    categoria_externa: rawItem.category_id != null ? String(rawItem.category_id) : null,
    marca_externa: rawItem.brand?.original_brand_name ?? null,
    imagens: rawItem.image?.image_url_list ?? [],
    tem_variacao: !!rawItem.has_model,
    dados_brutos: rawItem,
    ultima_atualizacao_externa: rawItem.update_time ? new Date(rawItem.update_time * 1000).toISOString() : null,
    sincronizado_em: new Date().toISOString(),
    ultima_atualizacao: new Date().toISOString(),
  }
  // Importante: nunca incluir produto_id aqui — é setado apenas manualmente
  // (fase de mapeamento, futura). Incluí-lo apagaria vínculos existentes a
  // cada re-sincronização via upsert.
  return { row, warnings }
}

export function mapModelToVariacaoRow(rawModel: any, anuncioId: string, empresaId: string): Record<string, any> {
  const precoInfo = rawModel.price_info?.[0]
  const estoque = rawModel.stock_info_v2?.summary_info?.total_available_stock
  return {
    empresa_id: empresaId,
    anuncio_id: anuncioId,
    model_id: String(rawModel.model_id),
    nome_variacao: rawModel.model_name ?? null,
    sku_variacao: rawModel.model_sku ?? null,
    preco: precoInfo?.current_price != null ? Number(precoInfo.current_price) : null,
    estoque: typeof estoque === 'number' ? estoque : null,
    status_externo: rawModel.status ?? null,
    dados_brutos: rawModel,
    sincronizado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function upsertAnuncio(sb: any, row: Record<string, any>): Promise<{ id: string }> {
  const { data, error } = await sb
    .from('marketplace_anuncios')
    .upsert(row, { onConflict: 'canal_id,id_externo' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id }
}

async function upsertVariacao(sb: any, row: Record<string, any>): Promise<void> {
  const { error } = await sb.from('marketplace_anuncio_variacoes').upsert(row, { onConflict: 'anuncio_id,model_id' })
  if (error) throw new Error(error.message)
}

// Processa um item já buscado (get_item_base_info): grava o anúncio e, se
// houver variações, busca e grava cada uma isoladamente (falha de variação
// não invalida o anúncio já salvo). Reaproveitado por syncCatalogo (lote) e
// syncSingleItem (um item só) para não duplicar essa lógica.
async function processRawItem(
  ctx: { sb: any; canal: ShopeeChannel },
  rawItem: any
): Promise<{ anuncioId: string; failed: SyncFailure[] }> {
  const itemIdStr = String(rawItem.item_id)
  const failed: SyncFailure[] = []

  const { row } = mapItemToAnuncioRow(rawItem, ctx.canal)
  const anuncio = await upsertAnuncio(ctx.sb, row)

  if (rawItem.has_model) {
    try {
      const modelData = await getModelList(ctx, Number(rawItem.item_id))
      const models: any[] = modelData?.model ?? []
      for (const rawModel of models) {
        try {
          const variRow = mapModelToVariacaoRow(rawModel, anuncio.id, ctx.canal.empresaId)
          await upsertVariacao(ctx.sb, variRow)
        } catch (eModel: any) {
          failed.push({ itemId: `${itemIdStr}:${rawModel?.model_id ?? '?'}`, error: eModel?.message ?? 'Erro ao processar variação' })
        }
      }
    } catch (eModels: any) {
      failed.push({ itemId: itemIdStr, error: `Falha ao buscar variações: ${eModels?.message ?? eModels}` })
    }
  }

  return { anuncioId: anuncio.id, failed }
}

// Ressincroniza um único anúncio (ação individual na tela de anúncios),
// sem passar pela paginação/lote da sincronização completa.
export async function syncSingleItem(
  sb: any,
  canalInicial: ShopeeChannel,
  idExterno: string
): Promise<{ ok: true; anuncioId: string; warnings: SyncFailure[] } | { ok: false; error: string }> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const ctx = { sb, canal }
    const rawItems = await getItemBaseInfoBatch(ctx, [Number(idExterno)])
    if (!rawItems[0]) return { ok: false, error: 'Item não encontrado ou indisponível na Shopee' }

    const { anuncioId, failed } = await processRawItem(ctx, rawItems[0])
    return { ok: true, anuncioId, warnings: failed }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao sincronizar item' }
  }
}

export async function testarConexao(
  sb: any,
  canalInicial: ShopeeChannel
): Promise<{ ok: true; shopName: string } | { ok: false; error: string }> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const { partnerId, partnerKey } = await getIntegracaoCredentials(sb)
    const data = await shopeeGet(
      '/api/v2/shop/get_shop_info',
      {},
      { partnerId, partnerKey, accessToken: canal.accessToken, shopId: canal.sellerId }
    )
    return { ok: true, shopName: data?.response?.shop_name ?? data?.shop_name ?? 'Loja Shopee' }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao testar conexão' }
  }
}

// Orquestra a sincronização completa: lista IDs → busca detalhes → busca
// variações → grava. Falhas por item/variação ficam isoladas (não abortam o
// restante); só uma falha ao nível do canal (token/credenciais) propaga.
export async function syncCatalogo(
  sb: any,
  canalInicial: ShopeeChannel,
  opts: { maxItems?: number } = {}
): Promise<SyncResult> {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const ctx = { sb, canal }

  const encontrados: { itemId: number; itemStatus: string }[] = []
  let truncated = false

  paginacao: for await (const pagina of listItemIds(ctx)) {
    for (const item of pagina) {
      if (encontrados.length >= maxItems) { truncated = true; break paginacao }
      encontrados.push(item)
    }
  }

  const failed: SyncFailure[] = []
  let upserted = 0

  if (encontrados.length === 0) {
    return { totalFound: 0, upserted: 0, failed: [], truncated: false }
  }

  const rawItems = await getItemBaseInfoBatch(ctx, encontrados.map(e => e.itemId))
  const retornados = new Set(rawItems.map((r: any) => String(r.item_id)))
  for (const item of encontrados) {
    if (!retornados.has(String(item.itemId))) {
      failed.push({ itemId: String(item.itemId), error: 'Não retornado por get_item_base_info' })
    }
  }

  for (const rawItem of rawItems) {
    const itemIdStr = String(rawItem.item_id)
    try {
      const { failed: itemFailed } = await processRawItem(ctx, rawItem)
      upserted++
      failed.push(...itemFailed)
    } catch (e: any) {
      failed.push({ itemId: itemIdStr, error: e?.message ?? 'Erro desconhecido ao processar item' })
    }
  }

  return { totalFound: encontrados.length, upserted, failed, truncated }
}
