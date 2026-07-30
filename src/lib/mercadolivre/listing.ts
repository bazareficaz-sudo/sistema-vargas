import { mlGet, mlPost, refreshAccessTokenIfNeeded } from './client'
import { syncSingleItem } from './sync'
import { MLApiError, type MLChannel } from './types'

// Criação/publicação de anúncio novo no Mercado Livre — diferente do resto
// da integração ML deste projeto (que até aqui só importava/sincronizava
// anúncios já existentes). Endpoints confirmados contra a doc pública da
// Mercado Livre (developers.mercadolivre.com.br) durante o planejamento:
// POST /items, GET /categories/{id}/attributes, GET /sites/{site}/
// domain_discovery/search, PUT /items/{id}. Um ponto com confiança mais
// baixa (não confirmado com 100% de certeza contra a doc): o endpoint exato
// de listing_types disponíveis por categoria — usa o endpoint geral do site
// por enquanto (ver getTiposAnuncio).

type CallCtx = { sb: any; canal: MLChannel }

const SITE_ID = 'MLB' // Brasil — único site suportado nesta integração hoje

export type CategoriaML = { id: string; name: string }

// Sem pai: categorias raiz do site. Com pai: filhas daquela categoria —
// diferente da Shopee (que devolve a árvore inteira numa chamada só), o ML
// pagina naturalmente nível a nível.
export async function getCategoryTree(ctx: CallCtx, parentId?: string): Promise<CategoriaML[]> {
  if (!parentId) {
    const data = await mlGet(`/sites/${SITE_ID}/categories`, {}, ctx.canal.accessToken)
    return (data ?? []).map((c: any) => ({ id: c.id, name: c.name }))
  }
  const data = await mlGet(`/categories/${parentId}`, {}, ctx.canal.accessToken)
  const filhas: any[] = data?.children_categories ?? []
  return filhas.map(c => ({ id: c.id, name: c.name }))
}

export type SugestaoCategoriaML = { categoryId: string; categoryName: string; domainName: string | null }

// domain_discovery — ferramenta oficial do ML pra sugerir categoria (e o
// "domínio" do produto) a partir do título, mesmo espírito do
// category_recommend já usado pra Shopee.
export async function sugerirCategoria(ctx: CallCtx, titulo: string): Promise<SugestaoCategoriaML | null> {
  const data = await mlGet(`/sites/${SITE_ID}/domain_discovery/search`, { q: titulo, limit: 1 }, ctx.canal.accessToken)
  const primeira = Array.isArray(data) ? data[0] : null
  if (!primeira?.category_id) return null
  return { categoryId: primeira.category_id, categoryName: primeira.category_name ?? '', domainName: primeira.domain_name ?? null }
}

export type AtributoML = {
  id: string
  name: string
  obrigatorio: boolean
  condicional?: boolean
  tipo: string // string | number | boolean | list ...
  valores: { id: string; name: string }[]
}

export async function getAtributos(ctx: CallCtx, categoryId: string): Promise<AtributoML[]> {
  const data = await mlGet(`/categories/${categoryId}/attributes`, {}, ctx.canal.accessToken)
  const lista: any[] = data ?? []
  return lista
    // A categoria devolve TUDO que o Mercado Livre conhece, inclusive campo
    // que o próprio formulário deles não mostra. Medido na categoria
    // "Extensores de Torneiras": 54 atributos, dos quais 45 `hidden` e 34
    // `read_only` — "IEPS", "Chave do produto", "Transportabilidade Hazmat".
    // Enchiam a tela e não podiam nem ser enviados. Sobram 9 de verdade.
    .filter(a => !a.tags?.hidden && !a.tags?.read_only)
    .map(a => ({
      id: a.id,
      name: a.name ?? a.id,
      obrigatorio: !!(a.tags?.required || a.tags?.catalog_required),
      // "conditional_required" é o que o ML cobra só em certas situações —
      // é daí que vinham as recusas citando atributo que não estava marcado
      // como obrigatório na tela.
      condicional: !!a.tags?.conditional_required,
      tipo: a.value_type ?? 'string',
      valores: (a.values ?? []).map((v: any) => ({ id: v.id, name: v.name })),
    }))
}

export type TipoAnuncioML = { id: string; name: string }

// Endpoint geral do site — lista os tipos existentes, mas não filtra pelos
// que a conta/categoria específica realmente pode usar (isso exigiria
// GET /users/{user_id}/available_listing_types?category_id=..., a
// confirmar numa iteração futura se a lista geral se mostrar imprecisa).
export async function getTiposAnuncio(ctx: CallCtx): Promise<TipoAnuncioML[]> {
  const data = await mlGet(`/sites/${SITE_ID}/listing_types`, {}, ctx.canal.accessToken)
  const lista: any[] = data ?? []
  return lista.map(t => ({ id: t.id, name: t.name ?? t.id }))
}

export type AtributoInputML = { id: string; valueName: string }

export type CriarAnuncioInputML = {
  produtoId: string
  empresaId: string
  categoryId: string
  titulo: string
  descricao: string
  preco: number
  estoque: number
  condicao: 'new' | 'used'
  listingTypeId: string
  atributos: AtributoInputML[]
  fotoUrls: string[]
}

export type ResultadoCriarAnuncioML =
  | { ok: true; anuncioId: string; itemId: string; permalink?: string; warning?: string }
  | { ok: false; erro: string }

export async function criarAnuncio(sb: any, canalInicial: MLChannel, input: CriarAnuncioInputML): Promise<ResultadoCriarAnuncioML> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    const body: Record<string, any> = {
      title: input.titulo,
      category_id: input.categoryId,
      price: input.preco,
      currency_id: 'BRL',
      available_quantity: input.estoque,
      buying_mode: 'buy_it_now',
      condition: input.condicao,
      listing_type_id: input.listingTypeId,
      // URL pública direta — o ML busca e processa a imagem no lado deles,
      // sem exigir upload prévio como a Shopee (confirmado na doc).
      pictures: input.fotoUrls.slice(0, 10).map(url => ({ source: url })),
    }
    if (input.atributos.length > 0) {
      body.attributes = input.atributos.map(a => ({ id: a.id, value_name: a.valueName }))
    }

    const resposta = await mlPost('/items', body, canal.accessToken)
    const itemId = resposta?.id
    if (!itemId) throw new MLApiError('Mercado Livre não retornou o id do anúncio criado', undefined, resposta)

    // Descrição é sub-recurso separado — precisa de uma segunda chamada
    // depois que o item já existe.
    if (input.descricao?.trim()) {
      try {
        await mlPost(`/items/${itemId}/description`, { plain_text: input.descricao.trim() }, canal.accessToken)
      } catch { /* não-fatal — anúncio já foi criado, descrição pode ser preenchida depois */ }
    }

    // Reaproveita o sync já existente (mesmo princípio do criarAnuncio da
    // Shopee) em vez de duplicar o mapeamento raw→marketplace_anuncios.
    const syncResultado = await syncSingleItem(sb, canal, String(itemId))
    if (!syncResultado.ok) {
      return { ok: true, anuncioId: '', itemId: String(itemId), warning: `Anúncio criado no Mercado Livre (item ${itemId}), mas falhou ao sincronizar de volta: ${syncResultado.error}. Use "Sincronizar agora" na tela de Anúncios.` }
    }

    await sb.from('marketplace_anuncios').update({ produto_id: input.produtoId }).eq('id', syncResultado.anuncioId)

    return { ok: true, anuncioId: syncResultado.anuncioId, itemId: String(itemId), permalink: resposta?.permalink }
  } catch (e: any) {
    const erro = e instanceof MLApiError ? e.message : (e?.message ?? 'Erro ao criar anúncio no Mercado Livre')
    return { ok: false, erro }
  }
}
