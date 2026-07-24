import { mlGet, refreshAccessTokenIfNeeded } from './client'
import { getItemsBatch, listItemIdsScan } from './catalog'
import type { MLChannel, SyncFailure, SyncResult } from './types'

// Teto de itens processados por chamada de sincronização — mesmo padrão da
// Shopee: sync síncrono e limitado por chamada. Diferente de antes, agora
// isso não trunca o catálogo pra sempre: o scroll_id de onde a busca parou
// fica salvo em marketplace_canais.ml_scan_scroll_id, e a PRÓXIMA chamada
// (clique manual ou cron) continua dali em vez de recomeçar do zero — ver
// listItemIdsScan em catalog.ts.
const DEFAULT_MAX_ITEMS = 500

const STATUS_MAP: Record<string, string> = {
  active: 'ativo',
  paused: 'pausado',
  closed: 'encerrado',
  under_review: 'rascunho',
  payment_required: 'rascunho',
  inactive: 'pausado',
}
function mapStatus(status?: string) {
  return STATUS_MAP[status ?? ''] ?? 'rascunho'
}

function extrairSku(item: any): string | null {
  if (item.seller_custom_field) return item.seller_custom_field
  const attr = (item.attributes ?? []).find((a: any) => a.id === 'SELLER_SKU')
  return attr?.value_name ?? null
}

// Mapeia o item bruto do Mercado Livre para a linha de marketplace_anuncios.
// Defensivo como o mapeamento da Shopee: campo ausente vira warning, não
// exceção — dados_brutos guarda o payload completo pra conferência.
export function mapItemToAnuncioRow(rawItem: any, canal: MLChannel): { row: Record<string, any>; warnings: string[] } {
  const warnings: string[] = []

  const preco = typeof rawItem.price === 'number' ? rawItem.price : 0
  if (rawItem.price == null) warnings.push('price ausente na resposta')

  const estoque = rawItem.available_quantity
  if (estoque === undefined) warnings.push('available_quantity ausente na resposta')

  const imagens: string[] = (rawItem.pictures ?? []).map((p: any) => p.secure_url ?? p.url).filter(Boolean)
  const marca = (rawItem.attributes ?? []).find((a: any) => a.id === 'BRAND')?.value_name ?? null

  const row = {
    empresa_id: canal.empresaId,
    canal_id: canal.id,
    titulo: rawItem.title ?? `Item ${rawItem.id}`,
    descricao: null, // descrição é endpoint separado (/items/{id}/description) — não busca aqui pra não dobrar chamadas no sync de catálogo
    preco_venda: preco,
    id_externo: String(rawItem.id),
    sku_canal: extrairSku(rawItem),
    status: mapStatus(rawItem.status),
    status_externo: rawItem.status ?? null,
    estoque_externo: typeof estoque === 'number' ? estoque : null,
    estoque_reservado: typeof estoque === 'number' ? estoque : 0,
    categoria_externa: rawItem.category_id ?? null,
    marca_externa: marca,
    imagens,
    tem_variacao: Array.isArray(rawItem.variations) && rawItem.variations.length > 0,
    url_anuncio: rawItem.permalink ?? null,
    dados_brutos: rawItem,
    ultima_atualizacao_externa: rawItem.last_updated ?? null,
    sincronizado_em: new Date().toISOString(),
    ultima_atualizacao: new Date().toISOString(),
  }
  // Importante: nunca incluir produto_id aqui — mesmo princípio da Shopee,
  // upsert não pode apagar um vínculo manual já existente.
  return { row, warnings }
}

export function mapVariationToVariacaoRow(rawVar: any, anuncioId: string, empresaId: string): Record<string, any> {
  const nomeVariacao = (rawVar.attribute_combinations ?? []).map((a: any) => a.value_name).filter(Boolean).join(' / ') || null
  const skuVariacao = rawVar.seller_sku ?? rawVar.seller_custom_field ?? null
  return {
    empresa_id: empresaId,
    anuncio_id: anuncioId,
    model_id: String(rawVar.id),
    nome_variacao: nomeVariacao,
    sku_variacao: skuVariacao,
    preco: typeof rawVar.price === 'number' ? rawVar.price : null,
    estoque: typeof rawVar.available_quantity === 'number' ? rawVar.available_quantity : null,
    status_externo: null,
    dados_brutos: rawVar,
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

// Mesmo princípio de auto-mapeamento aprendido da Shopee (ver src/lib/shopee/sync.ts).
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
  } catch { /* não-fatal — mesma filosofia defensiva da Shopee */ }
}

// Diferente da Shopee, as variações do ML já vêm embutidas no próprio item
// (rawItem.variations) — não precisa de uma segunda chamada por anúncio.
async function processRawItem(
  ctx: { sb: any; canal: MLChannel },
  rawItem: any
): Promise<{ anuncioId: string; failed: SyncFailure[] }> {
  const itemIdStr = String(rawItem.id)
  const failed: SyncFailure[] = []

  const { row } = mapItemToAnuncioRow(rawItem, ctx.canal)
  const anuncio = await upsertAnuncio(ctx.sb, row)

  await applyLearnedMapping(ctx.sb, {
    canalId: ctx.canal.id, nivel: 'anuncio', chave: row.sku_canal, tabela: 'marketplace_anuncios',
    rowId: anuncio.id, jaMapeado: !!anuncio.produtoId,
  })

  for (const rawVar of rawItem.variations ?? []) {
    try {
      const variRow = mapVariationToVariacaoRow(rawVar, anuncio.id, ctx.canal.empresaId)
      const variacao = await upsertVariacao(ctx.sb, variRow)
      await applyLearnedMapping(ctx.sb, {
        canalId: ctx.canal.id, nivel: 'variacao', chave: variRow.sku_variacao, tabela: 'marketplace_anuncio_variacoes',
        rowId: variacao.id, jaMapeado: !!variacao.produtoId,
      })
    } catch (eVar: any) {
      failed.push({ itemId: `${itemIdStr}:${rawVar?.id ?? '?'}`, error: eVar?.message ?? 'Erro ao processar variação' })
    }
  }

  return { anuncioId: anuncio.id, failed }
}

export async function syncSingleItem(
  sb: any,
  canalInicial: MLChannel,
  idExterno: string
): Promise<{ ok: true; anuncioId: string; warnings: SyncFailure[] } | { ok: false; error: string }> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const ctx = { sb, canal }
    const itens = await getItemsBatch(ctx, [idExterno])
    if (!itens[0]) return { ok: false, error: 'Item não encontrado ou indisponível no Mercado Livre' }

    const { anuncioId, failed } = await processRawItem(ctx, itens[0])
    return { ok: true, anuncioId, warnings: failed }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao sincronizar item' }
  }
}

export async function testarConexao(
  sb: any,
  canalInicial: MLChannel
): Promise<{ ok: true; shopName: string } | { ok: false; error: string }> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const data = await mlGet(`/users/${canal.sellerId}`, {}, canal.accessToken)
    return { ok: true, shopName: data?.nickname ?? 'Loja Mercado Livre' }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao testar conexão' }
  }
}

// Orquestra a sincronização completa: lista IDs → busca detalhes em lote
// (variações já vêm junto) → grava. Falhas por item/variação ficam
// isoladas; só falha de token/credenciais propaga pro nível do canal.
export async function syncCatalogo(
  sb: any,
  canalInicial: MLChannel,
  opts: { maxItems?: number } = {}
): Promise<SyncResult> {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const ctx = { sb, canal }

  const encontrados: string[] = []
  let scrollIdParaSalvar: string | null = null
  let passeCompleto = true // só vira false se paramos no meio (maxItems atingido)

  paginacao: for await (const pagina of listItemIdsScan(ctx, { scrollIdInicial: canal.mlScanScrollId ?? null })) {
    for (const id of pagina.ids) {
      if (encontrados.length >= maxItems) {
        scrollIdParaSalvar = pagina.scrollId
        passeCompleto = false
        break paginacao
      }
      encontrados.push(id)
    }
  }
  // passeCompleto=true (chegou ao fim do catálogo) → reseta o cursor pra
  // próxima sincronização recomeçar do zero e pegar itens novos/alterados.
  // passeCompleto=false (parou por maxItems) → salva onde parou pra
  // continuar dali na próxima chamada, sem repetir nem pular nada.
  await sb.from('marketplace_canais').update({ ml_scan_scroll_id: passeCompleto ? null : scrollIdParaSalvar }).eq('id', canal.id)

  if (encontrados.length === 0) {
    return { totalFound: 0, upserted: 0, failed: [], truncated: false }
  }

  const rawItems = await getItemsBatch(ctx, encontrados)
  const retornados = new Set(rawItems.map((r: any) => String(r.id)))
  const failed: SyncFailure[] = []
  for (const id of encontrados) {
    if (!retornados.has(id)) failed.push({ itemId: id, error: 'Não retornado por /items (multiget)' })
  }

  let upserted = 0
  for (const rawItem of rawItems) {
    const itemIdStr = String(rawItem.id)
    try {
      const { failed: itemFailed } = await processRawItem(ctx, rawItem)
      upserted++
      failed.push(...itemFailed)
    } catch (e: any) {
      failed.push({ itemId: itemIdStr, error: e?.message ?? 'Erro desconhecido ao processar item' })
    }
  }

  return { totalFound: encontrados.length, upserted, failed, truncated: !passeCompleto }
}
