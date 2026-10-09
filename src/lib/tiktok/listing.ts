// CRIAR ANÚNCIO NA TIKTOK SHOP a partir de um produto do sistema.
//
// Mesmo papel de src/lib/shopee/listing.ts e src/lib/nuvemshop/listing.ts,
// com o que é próprio da TikTok (Product API 202309, conferida na doc do
// Partner Center em 02/10/2026):
//   • categoria é da PLATAFORMA (árvore da TikTok), e precisa ser folha —
//     /categories/recommend sugere pelo título; /categories busca por nome;
//   • cada categoria tem atributos, alguns obrigatórios (is_requried — com a
//     grafia da própria API) — /categories/{id}/attributes;
//   • regras da categoria (medidas da embalagem obrigatórias, certificações)
//     — /categories/{id}/rules;
//   • marca é opcional (/brands); sem marca o produto sai sem marca;
//   • imagens não vão por URL: cada uma sobe por /images/upload (multipart)
//     e o produto referencia o `uri` devolvido. 300 a 4000 px, até 9;
//   • estoque é por ARMAZÉM: usa o armazém padrão de venda da loja.

import { getIntegracaoCredentials, refreshAccessTokenIfNeeded, tiktokGet, tiktokPost, tiktokPostArquivo } from './client'
import { syncSingleItem } from './sync'
import type { TiktokChannel } from './types'

type Ctx = { appKey: string; appSecret: string; accessToken: string; shopCipher: string }

async function contexto(sb: any, canalInicial: TiktokChannel): Promise<{ canal: TiktokChannel; opts: Ctx }> {
  const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
  const { appKey, appSecret } = await getIntegracaoCredentials()
  return { canal, opts: { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher } }
}

export type CategoriaTiktok = { id: string; nome: string; caminho: string; folha: boolean }

/** Categoria sugerida pela TikTok para o título (com o caminho até ela). */
export async function recomendarCategoria(sb: any, canal: TiktokChannel, titulo: string, descricao?: string | null): Promise<CategoriaTiktok | null> {
  const { opts } = await contexto(sb, canal)
  // Nome curto de cadastro ("Alicate Pressao 10 WJ1421") a TikTok recusa —
  // "does not match any category". A descrição junto dá o contexto que falta.
  const corpo: Record<string, string> = { product_title: titulo.slice(0, 300) }
  if (descricao?.trim()) corpo.description = descricao.trim().slice(0, 2000)
  const resp = await tiktokPost('/product/202309/categories/recommend', corpo, opts)
  const cats: any[] = resp?.data?.categories ?? []
  const folhaId = resp?.data?.leaf_category_id
  if (!folhaId || cats.length === 0) return null
  const ordenadas = [...cats].sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0))
  const folha = ordenadas.find(c => String(c.id) === String(folhaId)) ?? ordenadas[ordenadas.length - 1]
  return { id: String(folhaId), nome: folha?.name ?? '', caminho: ordenadas.map(c => c.name).join(' > '), folha: true }
}

/** Todas as categorias-folha disponíveis para a loja, com o caminho completo. */
export async function listarCategoriasFolha(sb: any, canal: TiktokChannel): Promise<CategoriaTiktok[]> {
  const { opts } = await contexto(sb, canal)
  // A árvore inteira vem numa chamada; o caminho é montado pelos parent_id.
  const resp = await tiktokGet('/product/202309/categories', { locale: 'pt-BR' }, opts)
  const todas: any[] = resp?.data?.categories ?? []
  const porId = new Map(todas.map(c => [String(c.id), c]))
  const caminho = (c: any): string => {
    const nomes: string[] = []
    let atual = c
    for (let i = 0; atual && i < 8; i++) { nomes.unshift(atual.local_name ?? ''); atual = porId.get(String(atual.parent_id)) }
    return nomes.filter(Boolean).join(' > ')
  }
  return todas
    .filter(c => c.is_leaf)
    .filter(c => !Array.isArray(c.permission_statuses) || !c.permission_statuses.includes('UNAVAILABLE'))
    .map(c => ({ id: String(c.id), nome: c.local_name ?? '', caminho: caminho(c), folha: true }))
}

/** Busca categorias-folha pelo nome, com o caminho completo de cada uma. */
export async function buscarCategorias(sb: any, canal: TiktokChannel, termo: string): Promise<CategoriaTiktok[]> {
  const t = termo.trim().toLowerCase()
  return (await listarCategoriasFolha(sb, canal))
    .filter(c => !t || c.nome.toLowerCase().includes(t))
    .slice(0, 60)
}

export type AtributoTiktok = {
  id: string; nome: string; obrigatorio: boolean; multiplo: boolean; personalizavel: boolean
  valores: { id: string; nome: string }[]
}

export type DetalhesCategoria = {
  atributos: AtributoTiktok[]
  marcas: { id: string; nome: string; autorizada: boolean }[]
  medidasObrigatorias: boolean
  certificacoesObrigatorias: string[]
}

export async function detalhesDaCategoria(sb: any, canal: TiktokChannel, categoryId: string): Promise<DetalhesCategoria> {
  const { opts } = await contexto(sb, canal)
  const [attrs, regras, marcas] = await Promise.all([
    tiktokGet(`/product/202309/categories/${categoryId}/attributes`, { locale: 'pt-BR' }, opts),
    tiktokGet(`/product/202309/categories/${categoryId}/rules`, { locale: 'pt-BR' }, opts).catch(() => null),
    tiktokGet('/product/202309/brands', { category_id: categoryId, page_size: 100 }, opts).catch(() => null),
  ])
  const atributos: AtributoTiktok[] = (attrs?.data?.attributes ?? [])
    // SALES_PROPERTY é variação (cor, tamanho) — não entra num produto simples.
    .filter((a: any) => a.type !== 'SALES_PROPERTY')
    .map((a: any) => ({
      id: String(a.id), nome: a.name ?? '',
      obrigatorio: !!(a.is_requried ?? a.is_required), multiplo: !!a.is_multiple_selection, personalizavel: !!a.is_customizable,
      valores: (a.values ?? []).map((v: any) => ({ id: String(v.id), nome: v.name ?? '' })),
    }))
    .sort((a: AtributoTiktok, b: AtributoTiktok) => Number(b.obrigatorio) - Number(a.obrigatorio))
  return {
    atributos,
    marcas: (marcas?.data?.brands ?? []).map((b: any) => ({ id: String(b.id), nome: b.name ?? '', autorizada: b.authorized_status === 'AUTHORIZED' })),
    medidasObrigatorias: !!regras?.data?.package_dimension?.is_required,
    certificacoesObrigatorias: (regras?.data?.product_certifications ?? []).filter((c: any) => c.is_required).map((c: any) => c.name ?? c.id),
  }
}

/** Marcas da categoria filtradas pelo nome (a lista da categoria vem paginada). */
export async function buscarMarcas(sb: any, canal: TiktokChannel, categoryId: string, nome: string) {
  const { opts } = await contexto(sb, canal)
  const resp = await tiktokGet('/product/202309/brands', { category_id: categoryId, brand_name: nome.slice(0, 100), page_size: 50 }, opts)
  return (resp?.data?.brands ?? []).map((b: any) => ({ id: String(b.id), nome: b.name ?? '', autorizada: b.authorized_status === 'AUTHORIZED' }))
}

/** Armazém de venda padrão da loja — o estoque da TikTok é por armazém. */
//
// A consulta de armazéns é do pacote de Logística da TikTok, que o app pode
// não ter ("Access denied ... access scope"). Nesse caso vale o armazém onde
// os anúncios que a loja já tem guardam estoque — é o mesmo armazém de venda.
async function armazemPadrao(sb: any, canal: TiktokChannel, opts: Ctx): Promise<string> {
  let resp: any
  try {
    resp = await tiktokGet('/logistics/202309/warehouses', {}, opts)
  } catch (e: any) {
    const doCatalogo = await armazemDosAnuncios(sb, canal.id)
    if (doCatalogo) return doCatalogo
    throw new Error(`consulta do armazém: ${e?.message ?? e}`)
  }
  const lista: any[] = resp?.data?.warehouses ?? []
  const deVenda = lista.filter(w => (w.type ?? 'SALES_WAREHOUSE') === 'SALES_WAREHOUSE' && (w.effect_status ?? 'ENABLED') === 'ENABLED')
  const escolhido = deVenda.find(w => w.is_default) ?? deVenda[0] ?? lista[0]
  if (!escolhido?.id) throw new Error('A loja TikTok não tem armazém de venda cadastrado — cadastre no Seller Center.')
  return String(escolhido.id)
}

/** Armazém mais usado nos SKUs dos anúncios já sincronizados do canal. */
async function armazemDosAnuncios(sb: any, canalId: string): Promise<string | null> {
  const { data } = await sb.from('marketplace_anuncios').select('dados_brutos').eq('canal_id', canalId).limit(200)
  const contagem = new Map<string, number>()
  for (const a of data ?? []) {
    for (const sku of a?.dados_brutos?.skus ?? []) {
      for (const inv of sku?.inventory ?? []) {
        if (inv?.warehouse_id) contagem.set(String(inv.warehouse_id), (contagem.get(String(inv.warehouse_id)) ?? 0) + 1)
      }
    }
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Sobe uma imagem (baixada da URL do cadastro) e devolve o `uri` da TikTok. */
async function subirImagem(opts: Ctx, url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`não foi possível baixar a imagem (${res.status})`)
  const tipo = res.headers.get('content-type') ?? 'image/jpeg'
  const bytes = await res.arrayBuffer()
  const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg'
  const form = new FormData()
  form.append('data', new Blob([bytes], { type: tipo }), `imagem.${ext}`)
  form.append('use_case', 'MAIN_IMAGE')
  // Upload de imagem não é de uma loja: a TikTok RECUSA o shop_cipher aqui
  // ("Unexpected identifier ... not required for this request").
  const { shopCipher: _semLoja, ...semCipher } = opts
  const resp = await tiktokPostArquivo('/product/202309/images/upload', form, semCipher)
  const uri = resp?.data?.uri
  if (!uri) throw new Error('a TikTok não devolveu o identificador da imagem')
  return String(uri)
}

/** Texto simples → HTML de parágrafos (a TikTok exige HTML na descrição). */
function descricaoHtml(texto: string): string {
  const t = texto.trim()
  if (/<\/?(p|br|ul|li|strong|b|div)[\s>]/i.test(t)) return t
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return t.split(/\n{2,}/).map(par => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('')
}

export type CriarAnuncioTiktokInput = {
  produtoId: string
  titulo: string
  descricao: string
  categoryId: string
  brandId?: string | null
  preco: number
  estoque: number
  sku: string | null
  ean: string | null
  pesoKg: number
  comprimentoCm?: number | null
  larguraCm?: number | null
  alturaCm?: number | null
  atributos: { id: string; valorId?: string | null; valorTexto?: string | null }[]
  fotoUrls: string[]
}

export type ResultadoCriarTiktok =
  | { ok: true; anuncioId: string; itemId: string; warning?: string }
  | { ok: false; erro: string }

export async function criarAnuncio(sb: any, canalInicial: TiktokChannel, input: CriarAnuncioTiktokInput): Promise<ResultadoCriarTiktok> {
  try {
    const { canal, opts } = await contexto(sb, canalInicial)
    if (input.fotoUrls.length === 0) return { ok: false, erro: 'A TikTok exige ao menos uma imagem.' }

    const uris: string[] = []
    const errosImagem: string[] = []
    for (const [i, url] of input.fotoUrls.slice(0, 9).entries()) {
      try { uris.push(await subirImagem(opts, url)) }
      catch (e: any) { errosImagem.push(`imagem ${i + 1}: ${e?.message ?? e}`) }
    }
    if (uris.length === 0) {
      // Mesmo motivo em todas as fotos (o caso comum) aparece uma vez só.
      const motivos = [...new Set(errosImagem.map(e => e.replace(/^imagem \d+: /, '')))]
      return { ok: false, erro: `Nenhuma imagem foi aceita pela TikTok: ${motivos.join(' | ')}` }
    }

    const armazem = await armazemPadrao(sb, canal, opts)
    const eanLimpo = String(input.ean ?? '').replace(/\D/g, '')
    const corpo: Record<string, any> = {
      save_mode: 'LISTING',
      title: input.titulo.slice(0, 300),
      description: descricaoHtml(input.descricao || input.titulo),
      category_id: input.categoryId,
      main_images: uris.map(uri => ({ uri })),
      skus: [{
        seller_sku: input.sku ?? undefined,
        price: { amount: input.preco.toFixed(2), currency: 'BRL' },
        inventory: [{ warehouse_id: armazem, quantity: Math.max(0, Math.min(99_999, Math.round(input.estoque))) }],
        // EAN-13 / GTIN: só manda se tiver o tamanho certo — código errado
        // derruba o anúncio inteiro.
        ...([8, 12, 13, 14].includes(eanLimpo.length) ? { identifier_code: { code: eanLimpo, type: eanLimpo.length === 13 ? 'EAN' : 'GTIN' } } : {}),
      }],
      package_weight: { value: input.pesoKg.toFixed(3), unit: 'KILOGRAM' },
    }
    if (input.brandId) corpo.brand_id = input.brandId
    if (input.comprimentoCm && input.larguraCm && input.alturaCm) {
      corpo.package_dimensions = {
        length: String(Math.ceil(input.comprimentoCm)), width: String(Math.ceil(input.larguraCm)),
        height: String(Math.ceil(input.alturaCm)), unit: 'CENTIMETER',
      }
    }
    const atributos = input.atributos
      .filter(a => a.id && (a.valorId || a.valorTexto?.trim()))
      .map(a => ({ id: a.id, values: [a.valorId ? { id: a.valorId } : { name: a.valorTexto!.trim() }] }))
    if (atributos.length > 0) corpo.product_attributes = atributos

    let resp: any
    try {
      resp = await tiktokPost('/product/202309/products', corpo, opts)
    } catch (e: any) {
      throw new Error(`criação do produto: ${e?.message ?? e}`)
    }
    const productId = resp?.data?.product_id
    if (!productId) return { ok: false, erro: 'A TikTok não devolveu o id do produto criado.' }

    // Traz de volta pelo sync (mesmo caminho das outras plataformas): o
    // anúncio nasce com o que a TikTok realmente gravou.
    const sincronizado = await syncSingleItem(sb, canal, String(productId))
    const avisos = [...errosImagem.map(e => `Imagem recusada — ${e}`), ...(resp?.data?.warnings ?? []).map((w: any) => w?.message).filter(Boolean)]
    if (!sincronizado.ok) {
      return { ok: true, anuncioId: '', itemId: String(productId), warning: `Produto criado na TikTok (id ${productId}), mas falhou ao sincronizar de volta: ${sincronizado.error}. Use "Sincronizar" na tela de Anúncios.` }
    }
    // Vínculo com o produto: correto aqui porque a criação é nossa.
    await sb.from('marketplace_anuncios').update({ produto_id: input.produtoId }).eq('id', sincronizado.anuncioId)
    if (input.pesoKg || input.comprimentoCm) {
      await sb.from('produtos').update({
        peso_kg: input.pesoKg || null, comprimento_cm: input.comprimentoCm || null,
        largura_cm: input.larguraCm || null, altura_cm: input.alturaCm || null,
      }).eq('id', input.produtoId)
    }
    return { ok: true, anuncioId: sincronizado.anuncioId, itemId: String(productId), warning: avisos.length ? avisos.join(' · ') : undefined }
  } catch (e: any) {
    // A TikTok explica o motivo da recusa em `message` (atributo faltando,
    // categoria sem permissão, imagem fora do tamanho…).
    return { ok: false, erro: `TikTok: ${e?.message ?? 'erro ao criar o anúncio'}` }
  }
}
