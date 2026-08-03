import { paginar, getLoja } from './catalog'
import { textoLocalizado, type NuvemshopChannel, type SyncFailure, type SyncResult } from './types'

// Teto de produtos por chamada de sincronização — mesmo princípio de Shopee e
// Mercado Livre: sync síncrono e limitado, para não estourar o tempo da
// função. Diferente do ML, aqui não há cursor persistido: a Nuvemshop pagina
// por número de página, e uma loja própria raramente tem o volume de um
// catálogo de marketplace. Se um dia passar deste teto, o caminho é o mesmo
// do ML — guardar a última página no canal.
const DEFAULT_MAX_ITEMS = 1000

/**
 * Status do anúncio.
 *
 * Na Nuvemshop não existe "pausado" como na Shopee/ML: o produto tem
 * `published` (visível na loja) e `visibility` ('visible' | 'unlisted' |
 * 'hidden'). Traduzo despublicado para 'pausado' porque é o que a tela de
 * Anúncios já sabe exibir, e o efeito prático é o mesmo — não está à venda.
 */
function mapStatus(raw: any): string {
  if (raw?.published === false) return 'pausado'
  if (raw?.visibility && raw.visibility !== 'visible') return 'pausado'
  return 'ativo'
}

/**
 * O SKU na Nuvemshop vive na VARIAÇÃO, não no produto — todo produto tem ao
 * menos uma variação, mesmo sem opções de escolha. Para o produto simples
 * (uma variação só), o SKU dela é o SKU do anúncio.
 */
function skuDoProduto(raw: any): string | null {
  const variantes: any[] = raw?.variants ?? []
  if (variantes.length !== 1) return null
  const sku = variantes[0]?.sku
  return sku ? String(sku) : null
}

function precoDoProduto(raw: any): number {
  const variantes: any[] = raw?.variants ?? []
  if (variantes.length === 0) return 0
  // Promoção vale mais que o preço cheio: é o valor que o cliente paga.
  const precos = variantes
    .map(v => Number(v?.promotional_price ?? v?.price ?? 0))
    .filter(p => p > 0)
  return precos.length > 0 ? Math.min(...precos) : 0
}

function estoqueDoProduto(raw: any): number | null {
  const variantes: any[] = raw?.variants ?? []
  if (variantes.length === 0) return null
  // `stock: null` na Nuvemshop significa estoque infinito (não controlado).
  // Somar tratando null como 0 mentiria; devolvo null e a tela mostra vazio.
  if (variantes.some(v => v?.stock == null)) return null
  return variantes.reduce((s, v) => s + Number(v.stock ?? 0), 0)
}

export function mapProdutoToAnuncioRow(raw: any, canal: NuvemshopChannel): { row: Record<string, any>; warnings: string[] } {
  const warnings: string[] = []

  const nome = textoLocalizado(raw?.name)
  if (!nome) warnings.push('nome ausente na resposta')

  const variantes: any[] = raw?.variants ?? []
  if (variantes.length === 0) warnings.push('produto sem variação — preço e estoque ficam vazios')

  const estoque = estoqueDoProduto(raw)
  const imagens: string[] = (raw?.images ?? [])
    .slice()
    .sort((a: any, b: any) => Number(a?.position ?? 0) - Number(b?.position ?? 0))
    .map((i: any) => i?.src)
    .filter(Boolean)

  const categoria = (raw?.categories ?? [])
    .map((c: any) => textoLocalizado(c?.name))
    .filter(Boolean)
    .join(' > ') || null

  const row = {
    empresa_id: canal.empresaId,
    canal_id: canal.id,
    titulo: nome ?? `Produto ${raw?.id}`,
    descricao: textoLocalizado(raw?.description),
    preco_venda: precoDoProduto(raw),
    id_externo: String(raw?.id),
    sku_canal: skuDoProduto(raw),
    status: mapStatus(raw),
    status_externo: raw?.visibility ?? (raw?.published === false ? 'hidden' : 'visible'),
    estoque_externo: estoque,
    estoque_reservado: estoque ?? 0,
    categoria_externa: categoria,
    marca_externa: raw?.brand ?? null,
    imagens,
    tem_variacao: variantes.length > 1,
    url_anuncio: raw?.canonical_url ?? null,
    dados_brutos: raw,
    ultima_atualizacao_externa: raw?.updated_at ?? null,
    sincronizado_em: new Date().toISOString(),
    ultima_atualizacao: new Date().toISOString(),
  }
  // Nunca incluir produto_id: upsert não pode apagar um vínculo manual já
  // feito pelo operador. Mesmo princípio de Shopee e Mercado Livre.
  return { row, warnings }
}

export function mapVarianteToVariacaoRow(rawVar: any, anuncioId: string, empresaId: string): Record<string, any> {
  // `values` é a combinação de opções da variação (ex: Cor=Azul, Tam=M), cada
  // uma localizada por idioma.
  const nomeVariacao = (rawVar?.values ?? [])
    .map((v: any) => textoLocalizado(v))
    .filter(Boolean)
    .join(' / ') || null

  return {
    empresa_id: empresaId,
    anuncio_id: anuncioId,
    model_id: String(rawVar?.id),
    nome_variacao: nomeVariacao,
    sku_variacao: rawVar?.sku ? String(rawVar.sku) : null,
    preco: Number(rawVar?.promotional_price ?? rawVar?.price ?? 0) || null,
    estoque: rawVar?.stock == null ? null : Number(rawVar.stock),
    status_externo: null,
    dados_brutos: rawVar,
    sincronizado_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
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

async function upsertVariacao(sb: any, row: Record<string, any>): Promise<{ id: string; produtoId: string | null }> {
  const { data, error } = await sb
    .from('marketplace_anuncio_variacoes')
    .upsert(row, { onConflict: 'anuncio_id,model_id' })
    .select('id, produto_id')
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id, produtoId: data.produto_id }
}

// Mesmo mecanismo de aprendizado já usado por Shopee e Mercado Livre: o que
// foi mapeado à mão uma vez volta a ser aplicado sozinho nos syncs seguintes.
async function aplicarMapeamentoAprendido(
  sb: any,
  opts: { canalId: string; nivel: 'anuncio' | 'variacao'; chave: string | null; tabela: string; rowId: string; jaMapeado: boolean },
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
  } catch { /* não-fatal — mesma filosofia defensiva das outras integrações */ }
}

// As variações já vêm dentro do produto na listagem — não há segunda chamada
// por item, como acontece na Shopee.
export async function processarProduto(
  ctx: { sb: any; canal: NuvemshopChannel },
  raw: any,
): Promise<{ anuncioId: string; failed: SyncFailure[] }> {
  const idStr = String(raw?.id)
  const failed: SyncFailure[] = []

  const { row } = mapProdutoToAnuncioRow(raw, ctx.canal)
  const anuncio = await upsertAnuncio(ctx.sb, row)

  await aplicarMapeamentoAprendido(ctx.sb, {
    canalId: ctx.canal.id, nivel: 'anuncio', chave: row.sku_canal,
    tabela: 'marketplace_anuncios', rowId: anuncio.id, jaMapeado: !!anuncio.produtoId,
  })

  // Produto sem opções tem exatamente uma variação; gravá-la como "variação"
  // só polui a tela. Só desdobra quando há mais de uma de verdade.
  const variantes: any[] = raw?.variants ?? []
  if (variantes.length > 1) {
    for (const rawVar of variantes) {
      try {
        const variRow = mapVarianteToVariacaoRow(rawVar, anuncio.id, ctx.canal.empresaId)
        const variacao = await upsertVariacao(ctx.sb, variRow)
        await aplicarMapeamentoAprendido(ctx.sb, {
          canalId: ctx.canal.id, nivel: 'variacao', chave: variRow.sku_variacao,
          tabela: 'marketplace_anuncio_variacoes', rowId: variacao.id, jaMapeado: !!variacao.produtoId,
        })
      } catch (e: any) {
        failed.push({ itemId: `${idStr}:${rawVar?.id ?? '?'}`, error: e?.message ?? 'Erro ao processar variação' })
      }
    }
  }

  return { anuncioId: anuncio.id, failed }
}

export async function testarConexao(
  canal: NuvemshopChannel,
): Promise<{ ok: true; shopName: string } | { ok: false; error: string }> {
  try {
    const loja = await getLoja(canal)
    return { ok: true, shopName: textoLocalizado(loja?.name) ?? `Loja ${canal.storeId}` }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao testar conexão' }
  }
}

/**
 * Sincroniza o catálogo da loja para `marketplace_anuncios`.
 *
 * Falha de um produto isolado não derruba a rodada — só falha de token ou
 * credencial propaga, porque aí nenhum produto seguinte funcionaria.
 */
export async function syncCatalogo(
  sb: any,
  canal: NuvemshopChannel,
  opts: { maxItems?: number } = {},
): Promise<SyncResult> {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS
  const ctx = { sb, canal }

  let totalFound = 0
  let upserted = 0
  const failed: SyncFailure[] = []
  let truncated = false

  for await (const pagina of paginar(canal, '/products')) {
    for (const raw of pagina) {
      if (totalFound >= maxItems) { truncated = true; break }
      totalFound += 1
      try {
        const { failed: falhasVariacao } = await processarProduto(ctx, raw)
        upserted += 1
        failed.push(...falhasVariacao)
      } catch (e: any) {
        failed.push({ itemId: String(raw?.id ?? '?'), error: e?.message ?? 'Erro ao processar produto' })
      }
    }
    if (truncated) break
  }

  return { totalFound, upserted, failed, truncated }
}

export async function syncSingleItem(
  sb: any,
  canal: NuvemshopChannel,
  idExterno: string,
): Promise<{ ok: true; anuncioId: string; warnings: SyncFailure[] } | { ok: false; error: string }> {
  try {
    const { nuvemshopGet } = await import('./client')
    const raw = await nuvemshopGet(canal, `/products/${idExterno}`)
    if (!raw?.id) return { ok: false, error: 'Produto não encontrado na Nuvemshop' }
    const { anuncioId, failed } = await processarProduto({ sb, canal }, raw)
    return { ok: true, anuncioId, warnings: failed }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erro ao sincronizar produto' }
  }
}
