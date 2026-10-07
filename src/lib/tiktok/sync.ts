import { paginarProdutos, getDetalheProduto, getLojasAutorizadas } from './catalog'
import { refreshAccessTokenIfNeeded } from './client'
import type { SyncFailure, SyncResult, TiktokChannel, TiktokProduct, TiktokSku } from './types'

// Teto de produtos por chamada de sincronização — mesmo princípio de
// Shopee/Mercado Livre/Nuvemshop: sync síncrono e limitado, para não
// estourar o tempo da função serverless.
const DEFAULT_MAX_ITEMS = 1000

const STATUS_MAP: Record<string, string> = {
  ACTIVATE: 'ativo',
  DRAFT: 'rascunho',
  PENDING: 'rascunho',
  FAILED: 'erro',
  SELLER_DEACTIVATED: 'pausado',
  PLATFORM_DEACTIVATED: 'pausado',
  FREEZE: 'erro',
  DELETED: 'encerrado',
}

function precoDoProduto(raw: TiktokProduct): number {
  const skus = raw.skus ?? []
  const precos = skus
    .map(s => Number(s.price?.sale_price ?? s.price?.tax_exclusive_price ?? 0))
    .filter(p => p > 0)
  return precos.length > 0 ? Math.min(...precos) : 0
}

export function estoqueDoProduto(raw: TiktokProduct): number | null {
  const skus = raw.skus ?? []
  if (skus.length === 0) return null
  let soma = 0
  let algumEncontrado = false
  for (const s of skus) {
    for (const inv of s.inventory ?? []) {
      if (typeof inv.quantity === 'number') { soma += inv.quantity; algumEncontrado = true }
    }
  }
  return algumEncontrado ? soma : null
}

function skuDoProduto(raw: TiktokProduct): string | null {
  const skus = raw.skus ?? []
  if (skus.length !== 1) return null
  return skus[0]?.seller_sku ? String(skus[0].seller_sku) : null
}

// `uri` é um identificador interno da TikTok (ex: "tos-alisg-i-.../<hash>"),
// não um endereço — confirmado com dado real. O link abrível vem em url_list.
function imagensDoProduto(raw: TiktokProduct): string[] {
  return (raw.main_images ?? [])
    .map((img: any) => img.url_list?.[0] ?? img.url ?? img.urls?.[0])
    .filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
}

// Mapeamento defensivo, mesmo espírito de Shopee/Nuvemshop: os nomes de
// campo da resposta real da TikTok Shop não puderam ser 100% confirmados
// contra um exemplo ao vivo (a doc oficial não renderizou o JSON de
// exemplo em texto simples no momento da implementação). Em vez de falhar,
// registra aviso e guarda o payload bruto — a primeira sincronização real
// mostra se algum campo precisa de ajuste, sem quebrar o resto do sync.
export function mapProdutoToAnuncioRow(raw: TiktokProduct, canal: TiktokChannel): { row: Record<string, any>; warnings: string[] } {
  const warnings: string[] = []

  if (!raw.title) warnings.push('título ausente na resposta')
  if (!raw.skus || raw.skus.length === 0) warnings.push('produto sem SKU na resposta')

  const estoque = estoqueDoProduto(raw)
  const row = {
    empresa_id: canal.empresaId,
    canal_id: canal.id,
    titulo: raw.title ?? `Produto ${raw.id}`,
    preco_venda: precoDoProduto(raw),
    id_externo: String(raw.id),
    sku_canal: skuDoProduto(raw),
    status: STATUS_MAP[raw.status ?? ''] ?? 'rascunho',
    status_externo: raw.status ?? null,
    estoque_externo: estoque,
    estoque_reservado: estoque ?? 0,
    imagens: imagensDoProduto(raw),
    tem_variacao: (raw.skus?.length ?? 0) > 1,
    dados_brutos: raw,
    ultima_atualizacao_externa: raw.update_time ? new Date(raw.update_time * 1000).toISOString() : null,
    sincronizado_em: new Date().toISOString(),
    ultima_atualizacao: new Date().toISOString(),
  }
  // Nunca incluir produto_id: upsert não pode desfazer um vínculo manual já
  // feito pelo operador. Mesmo princípio das outras três integrações.
  return { row, warnings }
}

async function upsertAnuncio(sb: any, row: Record<string, any>): Promise<{ id: string; produtoId: string | null }> {
  const { data, error } = await sb
    .from('marketplace_anuncios')
    .upsert(row, { onConflict: 'canal_id,id_externo' })
    .select('id, produto_id')
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id, produtoId: data.produto_id }
}

function nomeDaVariacao(sku: TiktokSku): string | null {
  const partes = (sku.sales_attributes ?? []).map(a => a.value_name).filter((v): v is string => !!v)
  if (partes.length > 0) return partes.join(' / ')
  return sku.seller_sku || null
}

// Cada SKU vira uma variação — é o endereço (`model_id` = id do SKU) que a
// fila usa para mandar estoque por modelo, igual à Shopee.
export function mapSkuToVariacaoRow(sku: TiktokSku, anuncioId: string, empresaId: string): Record<string, any> {
  const quantidades = (sku.inventory ?? []).map(i => i.quantity).filter((q): q is number => typeof q === 'number')
  const preco = Number(sku.price?.sale_price ?? sku.price?.tax_exclusive_price)
  return {
    empresa_id: empresaId,
    anuncio_id: anuncioId,
    model_id: String(sku.id),
    nome_variacao: nomeDaVariacao(sku),
    sku_variacao: sku.seller_sku || null,
    preco: Number.isFinite(preco) && preco > 0 ? preco : null,
    estoque: quantidades.length > 0 ? quantidades.reduce((a, b) => a + b, 0) : null,
    status_externo: sku.status_info?.status ?? null,
    dados_brutos: sku,
    sincronizado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  // Sem produto_id, pelo mesmo motivo do anúncio: não desfazer vínculo manual.
}

async function upsertVariacao(sb: any, row: Record<string, any>) {
  const { error } = await sb
    .from('marketplace_anuncio_variacoes')
    .upsert(row, { onConflict: 'anuncio_id,model_id' })
  if (error) throw new Error(error.message)
}

export async function processarProduto(
  ctx: { sb: any; canal: TiktokChannel },
  raw: TiktokProduct,
): Promise<{ anuncioId: string; failed: SyncFailure[] }> {
  // Search Products (paginarProdutos) confirmadamente não devolve
  // main_images nem o nome das variações (sales_attributes) — só Get Product
  // tem. É uma chamada extra por produto (sem lote), então só acontece
  // quando o que chegou está incompleto; quem já vem do detalhe não repete.
  let fonte = raw
  if (imagensDoProduto(raw).length === 0) {
    try {
      const detalhe = await getDetalheProduto(ctx.canal, String(raw.id))
      if (detalhe) fonte = { ...raw, ...detalhe }
    } catch { /* detalhe é complemento — não pode derrubar a sincronização do produto */ }
  }

  const { row } = mapProdutoToAnuncioRow(fonte, ctx.canal)
  const anuncio = await upsertAnuncio(ctx.sb, row)

  const failed: SyncFailure[] = []
  // Produto de SKU único não é gravado como variação — mesma regra da
  // Shopee: o anúncio simples já é o endereço dele.
  const skus = fonte.skus ?? []
  if (skus.length > 1) {
    for (const sku of skus) {
      if (sku?.id == null) continue
      try {
        await upsertVariacao(ctx.sb, mapSkuToVariacaoRow(sku, anuncio.id, ctx.canal.empresaId))
      } catch (e: any) {
        failed.push({ itemId: `${raw.id}:${sku.id}`, error: e?.message ?? 'Erro ao gravar variação' })
      }
    }
  }

  return { anuncioId: anuncio.id, failed }
}

// Ressincroniza um único anúncio (ação individual na tela de anúncios).
export async function syncSingleItem(
  sb: any, canalInicial: TiktokChannel, productId: string,
): Promise<{ ok: true; anuncioId: string; warnings: SyncFailure[] } | { ok: false; error: string }> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const detalhe = await getDetalheProduto(canal, productId)
    if (!detalhe) return { ok: false, error: 'Produto não encontrado na TikTok Shop' }
    const r = await processarProduto({ sb, canal }, { ...detalhe, id: detalhe.id ?? productId })
    return { ok: true, anuncioId: r.anuncioId, warnings: r.failed }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao sincronizar anúncio' }
  }
}

export async function testarConexao(
  canal: TiktokChannel,
): Promise<{ ok: true; shopName: string } | { ok: false; error: string }> {
  try {
    const lojas = await getLojasAutorizadas(canal.accessToken)
    const loja = lojas.find(l => l.id === canal.sellerId) ?? lojas[0]
    return { ok: true, shopName: loja?.name ?? `Loja ${canal.sellerId}` }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao testar conexão' }
  }
}

/**
 * Sincroniza o catálogo da loja para `marketplace_anuncios`.
 *
 * Falha de um produto isolado não derruba a rodada — só falha de
 * token/credencial propaga, porque aí nenhum produto seguinte funcionaria.
 */
export async function syncCatalogo(
  sb: any,
  canal: TiktokChannel,
  opts: { maxItems?: number } = {},
): Promise<SyncResult> {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS
  const ctx = { sb, canal }

  let totalFound = 0
  let upserted = 0
  const failed: SyncFailure[] = []
  let truncated = false

  for await (const pagina of paginarProdutos(canal)) {
    for (const raw of pagina) {
      if (totalFound >= maxItems) { truncated = true; break }
      totalFound += 1
      try {
        const r = await processarProduto(ctx, raw)
        failed.push(...r.failed)
        upserted += 1
      } catch (e: any) {
        failed.push({ itemId: String(raw?.id ?? '?'), error: e?.message ?? 'Erro ao processar produto' })
      }
    }
    if (truncated) break
  }

  return { totalFound, upserted, failed, truncated }
}
