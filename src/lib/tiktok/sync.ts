import { paginarProdutos, getDetalheProduto, getLojasAutorizadas } from './catalog'
import type { SyncFailure, SyncResult, TiktokChannel, TiktokProduct } from './types'

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

function estoqueDoProduto(raw: TiktokProduct): number | null {
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

function imagensDoProduto(raw: TiktokProduct): string[] {
  return (raw.main_images ?? [])
    .map((img: any) => img.url ?? img.uri ?? img.url_list?.[0] ?? img.urls?.[0])
    .filter((u): u is string => !!u)
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

export async function processarProduto(
  ctx: { sb: any; canal: TiktokChannel },
  raw: TiktokProduct,
): Promise<{ anuncioId: string }> {
  const { row } = mapProdutoToAnuncioRow(raw, ctx.canal)

  // Search Products (paginarProdutos) confirmadamente não devolve
  // main_images — só Get Product tem a imagem, mas é uma chamada extra por
  // produto (sem lote), então só é feita quando falta imagem mesmo.
  if (row.imagens.length === 0) {
    try {
      const detalhe = await getDetalheProduto(ctx.canal, String(raw.id))
      if (detalhe) {
        const imagensDetalhe = imagensDoProduto(detalhe)
        if (imagensDetalhe.length > 0) row.imagens = imagensDetalhe
      }
    } catch { /* imagem é um extra — não pode derrubar a sincronização do produto */ }
  }

  const anuncio = await upsertAnuncio(ctx.sb, row)
  return { anuncioId: anuncio.id }
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
        await processarProduto(ctx, raw)
        upserted += 1
      } catch (e: any) {
        failed.push({ itemId: String(raw?.id ?? '?'), error: e?.message ?? 'Erro ao processar produto' })
      }
    }
    if (truncated) break
  }

  return { totalFound, upserted, failed, truncated }
}
