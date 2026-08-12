import { getIntegracaoCredentials, refreshAccessTokenIfNeeded, shopeeGet } from './client'
import { getItemBaseInfoBatch, getItemExtraInfoBatch, getModelList, listItemIds, type ShopeeCursor } from './catalog'
import type { ShopeeChannel, SyncFailure, SyncResult } from './types'
import { colunasQualidade } from '@/lib/marketplace/qualidade'

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
export function mapItemToAnuncioRow(rawItem: any, canal: ShopeeChannel, vendas?: number | null): { row: Record<string, any>; warnings: string[] } {
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
    ...(vendas != null ? { vendas } : {}),
    dados_brutos: rawItem,
    // Qualidade recalculada a cada sincronização: o anúncio muda no
    // marketplace e a nota tem que acompanhar sozinha, sem passada extra.
    ...colunasQualidade('shopee', rawItem),
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

export async function upsertAnuncio(sb: any, row: Record<string, any>): Promise<{ id: string; produtoId: string | null }> {
  const { data, error } = await sb
    .from('marketplace_anuncios')
    .upsert(row, { onConflict: 'canal_id,id_externo' })
    .select('id, produto_id')
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id, produtoId: data.produto_id }
}

async function upsertVariacao(sb: any, row: Record<string, any>): Promise<{ id: string; produtoId: string | null }> {
  const { data, error } = await sb
    .from('marketplace_anuncio_variacoes')
    .upsert(row, { onConflict: 'anuncio_id,model_id' })
    .select('id, produto_id')
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id, produtoId: data.produto_id }
}

// Se a linha (anúncio ou variação) ainda não tiver produto vinculado, olha
// se já existe um mapeamento aprendido (canal + nível + chave = SKU) e
// aplica sozinho — sem nunca sobrescrever um vínculo já existente. Mesmo
// princípio de EntradasXmlClient.tsx's autoMapearItens (NF-e), só que do
// lado do servidor porque a importação Shopee roda em processRawItem.
async function applyLearnedMapping(
  sb: any,
  opts: { canalId: string; nivel: 'anuncio' | 'variacao'; chave: string | null; tabela: string; rowId: string; jaMapeado: boolean }
): Promise<void> {
  if (opts.jaMapeado || !opts.chave) return
  try {
    const { data: mapa } = await sb.from('marketplace_mapeamentos')
      .select('produto_id')
      .eq('canal_id', opts.canalId).eq('nivel', opts.nivel).eq('chave', opts.chave)
      .maybeSingle()
    if (mapa?.produto_id) {
      await sb.from(opts.tabela).update({ produto_id: mapa.produto_id }).eq('id', opts.rowId)
    }
  } catch { /* não-fatal — mesma filosofia defensiva do restante deste arquivo */ }
}

// Processa um item já buscado (get_item_base_info): grava o anúncio e, se
// houver variações, busca e grava cada uma isoladamente (falha de variação
// não invalida o anúncio já salvo). Reaproveitado por syncCatalogo (lote) e
// syncSingleItem (um item só) para não duplicar essa lógica.
async function processRawItem(
  ctx: { sb: any; canal: ShopeeChannel },
  rawItem: any,
  vendas?: number | null
): Promise<{ anuncioId: string; failed: SyncFailure[] }> {
  const itemIdStr = String(rawItem.item_id)
  const failed: SyncFailure[] = []

  const { row } = mapItemToAnuncioRow(rawItem, ctx.canal, vendas)
  const anuncio = await upsertAnuncio(ctx.sb, row)

  // anuncio.produtoId reflete o estado real após o upsert (upsert nunca
  // inclui produto_id no payload, então um vínculo manual já existente
  // é preservado) — só aplica o mapeamento aprendido se ainda não houver um.
  await applyLearnedMapping(ctx.sb, {
    canalId: ctx.canal.id, nivel: 'anuncio', chave: row.sku_canal, tabela: 'marketplace_anuncios',
    rowId: anuncio.id, jaMapeado: !!anuncio.produtoId,
  })

  if (rawItem.has_model) {
    try {
      const modelData = await getModelList(ctx, Number(rawItem.item_id))
      const models: any[] = modelData?.model ?? []
      for (const rawModel of models) {
        try {
          const variRow = mapModelToVariacaoRow(rawModel, anuncio.id, ctx.canal.empresaId)
          const variacao = await upsertVariacao(ctx.sb, variRow)
          await applyLearnedMapping(ctx.sb, {
            canalId: ctx.canal.id, nivel: 'variacao', chave: variRow.sku_variacao, tabela: 'marketplace_anuncio_variacoes',
            rowId: variacao.id, jaMapeado: !!variacao.produtoId,
          })
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

    // Falha ao buscar vendas não pode derrubar o resto da sincronização do
    // item — é uma métrica a mais, não um dado essencial (mesma filosofia
    // defensiva do restante deste arquivo).
    let vendas: number | null = null
    try {
      const extra = await getItemExtraInfoBatch(ctx, [Number(idExterno)])
      vendas = extra[0]?.sale ?? null
    } catch { /* segue sem vendas */ }

    const { anuncioId, failed } = await processRawItem(ctx, rawItems[0], vendas)
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
  opts: { maxItems?: number; cursorInicial?: ShopeeCursor | null; prazo?: number } = {}
): Promise<SyncResult & { proximoCursor?: ShopeeCursor | null; passeCompleto?: boolean }> {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const ctx = { sb, canal }

  const failed: SyncFailure[] = []
  let totalFound = 0
  let upserted = 0
  let proximoCursor: ShopeeCursor | null = null
  let passeCompleto = true
  let truncated = false

  // Trabalha PÁGINA A PÁGINA: lista os ids da página, busca os detalhes,
  // grava, e só então avança o cursor.
  //
  // A versão anterior listava tudo primeiro e processava depois. O orçamento
  // de tempo só era conferido durante a listagem — que é a parte barata. A
  // parte cara (detalhes + gravação, uma chamada e vários upserts por item)
  // rodava inteira sem nenhuma checagem, então a função podia ser morta pela
  // Vercel no meio dela sem salvar cursor nenhum. Processando por página, o
  // ponto de parada é sempre uma fronteira exata e o custo por checagem é o
  // de uma página, não o do lote inteiro.
  //
  // Não se perde nada em número de chamadas: o lote de detalhes da Shopee é
  // de 20 itens e a página também tem 20.
  paginacao: for await (const pagina of listItemIds(ctx, { cursorInicial: opts.cursorInicial ?? null })) {
    const ids = pagina.itens.map(e => e.itemId)
    totalFound += ids.length

    const rawItems = await getItemBaseInfoBatch(ctx, ids)
    const retornados = new Set(rawItems.map((r: any) => String(r.item_id)))
    for (const item of pagina.itens) {
      if (!retornados.has(String(item.itemId))) {
        failed.push({ itemId: String(item.itemId), error: 'Não retornado por get_item_base_info' })
      }
    }

    // Vendas é uma chamada à parte (get_item_extra_info) — falha aqui não pode
    // travar o sync, só faz os anúncios ficarem sem essa métrica desta vez
    // (mantêm o valor antigo, já que mapItemToAnuncioRow só inclui `vendas`
    // no upsert quando o valor veio preenchido).
    const vendasPorItem = new Map<string, number>()
    try {
      const extraInfo = await getItemExtraInfoBatch(ctx, ids)
      for (const info of extraInfo) {
        if (info?.item_id != null && info?.sale != null) vendasPorItem.set(String(info.item_id), Number(info.sale))
      }
    } catch { /* segue sem vendas nesta página */ }

    for (const rawItem of rawItems) {
      const itemIdStr = String(rawItem.item_id)
      try {
        const { failed: itemFailed } = await processRawItem(ctx, rawItem, vendasPorItem.get(itemIdStr) ?? null)
        upserted++
        failed.push(...itemFailed)
      } catch (e: any) {
        failed.push({ itemId: itemIdStr, error: e?.message ?? 'Erro desconhecido ao processar item' })
      }
    }

    // Cursor avança só DEPOIS de a página estar gravada. Se a função morrer
    // antes disto, a rodada seguinte refaz esta página — repetir é inofensivo
    // (o upsert é idempotente); pular não seria.
    proximoCursor = pagina.cursor

    if (pagina.cursor === null) { passeCompleto = true; break paginacao }

    const acabouOrcamento = opts.prazo != null && Date.now() > opts.prazo
    if (totalFound >= maxItems || acabouOrcamento) {
      truncated = true
      passeCompleto = false
      break paginacao
    }
  }

  return { totalFound, upserted, failed, truncated, proximoCursor, passeCompleto }
}
