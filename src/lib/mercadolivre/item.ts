// Leitura de um anúncio do Mercado Livre a partir da URL — inclusive de
// anúncios de outros vendedores, pra reaproveitar dados na criação de um
// anúncio nosso.
//
// IMPORTANTE: até meados de 2026 estes endpoints (`/items/{id}`) eram
// abertos e a leitura era feita sem token. O ML fechou o acesso anônimo —
// hoje responde 403 ("PA_UNAUTHORIZED_RESULT_FROM_POLICIES") sem
// Authorization. Por isso a leitura passou a exigir o access_token de um
// canal ML conectado da empresa (o mesmo usado pelo resto da integração).

import { mlGet } from './client'
import { MLApiError } from './types'

export type AtributoImportado = { id: string; name: string; valueName: string }

// Atributos que nunca devem ser copiados de um anúncio de terceiro:
// SELLER_SKU é o código interno do OUTRO vendedor (não tem relação com o
// nosso cadastro) e ITEM_CONDITION já é tratado pelo campo `condicao`.
const ATRIBUTOS_NAO_IMPORTAVEIS = new Set(['SELLER_SKU', 'ITEM_CONDITION'])

export type AnuncioMercadoLivre = {
  titulo: string
  descricao: string
  preco: number
  imagens: string[]
  categoriaNomeExterna: string | null
  marcaSugerida: string | null
  temVariacoes: boolean
  // Campos usados pela importação dentro do fluxo de criar anúncio —
  // o importador de produto (ImportarProdutoUrlModal) ignora estes.
  categoriaId: string | null
  categoriaCaminho: { id: string; name: string }[]
  atributos: AtributoImportado[]
  condicao: 'new' | 'used' | null
  /**
   * O que foi lido de fato. Num link de catálogo pode ser o anúncio indicado
   * no link (`anuncio`) ou o produto do catálogo (`catalogo`) — e o id muda
   * junto: é ele que identifica o rascunho, não o id do caminho.
   */
  tipoPagina: 'anuncio' | 'catalogo'
  idExterno: string
  /** Catálogo: o anúncio que está com a caixa de compra (de onde veio o preço). */
  idAnuncioVencedor: string | null
}

/**
 * O que um link do Mercado Livre aponta.
 *
 *   anuncio   /MLB-123456789-slug  — o anúncio de UM vendedor. É o único que
 *             a API /items/ atende, e o único que dá para importar.
 *   catalogo  /p/MLB123 ou /up/MLBU123 — a página de PRODUTO, onde vários
 *             vendedores disputam a caixa de compra. Não pertence a ninguém,
 *             e /items/ não a atende.
 *   nenhum    não há id de anúncio no caminho.
 */
export type AlvoUrlML =
  | { tipo: 'anuncio'; itemId: string }
  | { tipo: 'catalogo'; catalogoId: string }
  | { tipo: 'nenhum' }

/**
 * Classifica um link do Mercado Livre, olhando SÓ O CAMINHO.
 *
 * POR QUE SÓ O CAMINHO, e isto é a correção de um defeito real: a versão
 * anterior fazia `url.match(/MLB-?(\d+)/i)` na URL inteira. Os links que o ML
 * gera na busca carregam parâmetros de rastreio com id de item dentro:
 *
 *   .../up/MLBU3472391724#polycard_client=search-desktop&wid=MLB5099887766
 *                                                         ^^^^^^^^^^^^^^^
 *
 * O `wid` era lido como se fosse o anúncio. No caso reportado o ML negou a
 * leitura e o operador viu uma mensagem pedindo para reconectar a conta — o
 * conselho errado, para um problema que não era de autorização.
 *
 * O caso PIOR é o que não deu erro: se aquele id de rastreio fosse legível,
 * o sistema teria importado um anúncio DIFERENTE do que a pessoa abriu, sem
 * nada indicando a troca.
 *
 * `MLBU` é distinguido de `MLB` de propósito: `MLB-?\d` não casa com `MLBU`
 * (a letra U não é dígito nem hífen), então a versão antiga simplesmente não
 * via a página de catálogo — e ia procurar id noutro lugar da URL.
 */
export function classificarUrlML(url: string): AlvoUrlML {
  let caminho: string
  try {
    caminho = new URL(url).pathname
  } catch {
    // Não é URL: pode ser o id colado sozinho.
    caminho = String(url ?? '')
  }

  // Catálogo primeiro: /up/MLBU... e /p/MLB... são páginas de produto.
  const catalogo = caminho.match(/\/(?:p|up)\/(MLB[A-Z]?\d+)/i)
  if (catalogo) return { tipo: 'catalogo', catalogoId: catalogo[1].toUpperCase() }

  // Anúncio: MLB-123456789 (com hífen, formato de link) ou MLB123456789.
  // `(?![A-Z])` impede que MLBU3472391724 seja lido como MLB + "U347..." —
  // sem isso, um catálogo fora do padrão /up/ viraria um id inventado.
  const anuncio = caminho.match(/MLB-?(?![A-Z])(\d+)/i)
  if (anuncio) return { tipo: 'anuncio', itemId: `MLB${anuncio[1]}` }

  return { tipo: 'nenhum' }
}

/**
 * O id do anúncio, quando o link for de um anúncio.
 *
 * Devolve `null` para página de catálogo — que é diferente de "não achei id".
 * Quem precisa distinguir os dois usa `classificarUrlML`.
 */
export function extrairItemId(url: string): string | null {
  const alvo = classificarUrlML(url)
  return alvo.tipo === 'anuncio' ? alvo.itemId : null
}

/**
 * O anúncio que um link de CATÁLOGO indica, quando indica.
 *
 * Os links que o ML gera na busca e na própria página de catálogo carregam o
 * anúncio exibido: `wid=MLB...` no fragmento, ou `item_id:MLB...` em
 * `pdp_filters`. Sozinho ele NÃO é confiável — é rastreio (ver
 * `classificarUrlML`) — e por isso só é usado depois de conferido contra o
 * catálogo do caminho (`conferirAnuncioDoCatalogo`).
 */
export function anuncioIndicadoNoLink(url: string): string | null {
  let resto: string
  try {
    const u = new URL(url)
    // `item_id:MLB...` costuma vir codificado na query (`item_id%3AMLB...`).
    resto = `${decodeURIComponent(u.search)}&${decodeURIComponent(u.hash)}`
  } catch {
    return null
  }
  const m = resto.match(/(?:[?&#]wid=|item_id[:=])MLB-?(\d+)/i)
  return m ? `MLB${m[1]}` : null
}

/**
 * O anúncio pertence ao catálogo do link? `MLBU...` é produto de UM vendedor
 * (`user_product_id`); `MLB...` em /p/ é produto do catálogo do ML
 * (`catalog_product_id`). Sem esta conferência, um `wid` de outra coisa
 * importaria um anúncio diferente do que a pessoa abriu.
 */
export function conferirAnuncioDoCatalogo(
  item: { user_product_id?: string | null; catalog_product_id?: string | null },
  catalogoId: string,
): boolean {
  const id = catalogoId.toUpperCase()
  if (id.startsWith('MLBU')) return String(item.user_product_id ?? '').toUpperCase() === id
  return String(item.catalog_product_id ?? '').toUpperCase() === id
}

async function categoriaDe(categoryId: string | null, accessToken: string) {
  if (!categoryId) return { categoriaNomeExterna: null as string | null, categoriaCaminho: [] as { id: string; name: string }[] }
  try {
    const cat = await mlGet(`/categories/${categoryId}`, {}, accessToken)
    // path_from_root já vem do ML na ordem raiz → folha, exatamente o
    // formato que o modal de criar anúncio usa pra exibir o caminho.
    return {
      categoriaNomeExterna: (cat?.name ?? null) as string | null,
      categoriaCaminho: (cat?.path_from_root ?? []).map((c: any) => ({ id: c.id, name: c.name })) as { id: string; name: string }[],
    }
  } catch {
    // apenas uma dica de texto — não deve derrubar a importação
    return { categoriaNomeExterna: null as string | null, categoriaCaminho: [] as { id: string; name: string }[] }
  }
}

function atributosDe(brutos: any[]): { atributos: AtributoImportado[]; marcaSugerida: string | null } {
  return {
    marcaSugerida: brutos.find((a: any) => a?.id === 'BRAND')?.value_name ?? null,
    atributos: brutos
      .filter(a => a?.id && a?.value_name && !ATRIBUTOS_NAO_IMPORTAVEIS.has(a.id))
      .map(a => ({ id: a.id, name: a.name ?? a.id, valueName: String(a.value_name) })),
  }
}

/** Lê UM anúncio de vendedor pela API /items/. */
async function lerItem(itemId: string, accessToken: string): Promise<{ dados: AnuncioMercadoLivre; bruto: any }> {
  let item: any
  try {
    item = await mlGet(`/items/${itemId}`, {}, accessToken)
  } catch (e: any) {
    if (e instanceof MLApiError && /not found|404/i.test(e.message)) throw new Error('Anúncio não encontrado ou removido.')
    throw new Error(`Erro ao consultar o Mercado Livre: ${e?.message ?? 'falha desconhecida'}`)
  }

  if (item.status && item.status !== 'active') {
    throw new Error('Este anúncio não está mais ativo no Mercado Livre.')
  }

  // Descrição e categoria são complementos — se qualquer uma falhar, a
  // importação continua com o que já deu certo.
  let descricao = ''
  try {
    const desc = await mlGet(`/items/${itemId}/description`, {}, accessToken)
    descricao = desc?.plain_text ?? ''
  } catch { /* anúncio sem descrição ou sem permissão de leitura dela */ }

  const cat = await categoriaDe(item.category_id ?? null, accessToken)
  const { atributos, marcaSugerida } = atributosDe(item.attributes ?? [])
  const imagens: string[] = (item.pictures ?? []).map((p: any) => p.secure_url ?? p.url).filter(Boolean)

  return {
    bruto: item,
    dados: {
      titulo: item.title ?? '',
      descricao,
      preco: typeof item.price === 'number' ? item.price : 0,
      imagens,
      ...cat,
      marcaSugerida,
      temVariacoes: Array.isArray(item.variations) && item.variations.length > 0,
      categoriaId: item.category_id ?? null,
      atributos,
      condicao: item.condition === 'new' || item.condition === 'used' ? item.condition : null,
      tipoPagina: 'anuncio',
      idExterno: itemId,
      idAnuncioVencedor: null,
    },
  }
}

/**
 * Lê o PRODUTO DO CATÁLOGO (/p/MLB...): é o conteúdo de referência do ML —
 * nome, fotos, ficha técnica e descrição — e não pertence a vendedor
 * nenhum. O preço vem do anúncio que está com a caixa de compra; sem
 * vencedor, do primeiro anúncio do catálogo.
 */
async function lerProdutoCatalogo(produtoId: string, accessToken: string): Promise<AnuncioMercadoLivre> {
  let produto: any
  try {
    produto = await mlGet(`/products/${produtoId}`, {}, accessToken)
  } catch (e: any) {
    if (e instanceof MLApiError && /not found|404/i.test(e.message)) throw new Error('Produto de catálogo não encontrado no Mercado Livre.')
    throw new Error(`Erro ao consultar o catálogo do Mercado Livre: ${e?.message ?? 'falha desconhecida'}`)
  }

  let vencedor: { item_id?: string; price?: number; category_id?: string } | null = produto?.buy_box_winner ?? null
  if (!vencedor?.item_id) {
    try {
      const lista = await mlGet(`/products/${produtoId}/items`, { limit: 1 }, accessToken)
      vencedor = lista?.results?.[0] ?? null
    } catch { /* catálogo sem anúncio ativo: segue sem preço */ }
  }

  const categoryId = vencedor?.category_id ?? produto?.category_id ?? null
  const cat = await categoriaDe(categoryId, accessToken)
  const { atributos, marcaSugerida } = atributosDe(produto?.attributes ?? [])
  const imagens: string[] = (produto?.pictures ?? []).map((p: any) => p.secure_url ?? p.url).filter(Boolean)

  // Descrição do catálogo: o texto curto e, sem ele, as características
  // principais como lista.
  const curta = String(produto?.short_description?.content ?? '').trim()
  const caracteristicas: string[] = (produto?.main_features ?? []).map((f: any) => String(f?.text ?? '').trim()).filter(Boolean)
  const descricao = curta || caracteristicas.map(t => `• ${t}`).join('\n')

  return {
    titulo: produto?.name ?? '',
    descricao,
    preco: typeof vencedor?.price === 'number' ? vencedor.price : 0,
    imagens,
    ...cat,
    marcaSugerida,
    temVariacoes: false,
    categoriaId: categoryId,
    atributos,
    condicao: 'new',
    tipoPagina: 'catalogo',
    idExterno: produtoId,
    idAnuncioVencedor: vencedor?.item_id ?? null,
  }
}

const SEM_ANUNCIO_NO_LINK_UP =
  'Este link é de uma página de produto (/up/) e não trouxe o anúncio exibido. Abra o anúncio pela '
  + 'busca do Mercado Livre e copie o endereço de novo — o link da busca leva o anúncio junto — ou '
  + 'clique no nome do vendedor e cole o endereço do anúncio dele.'

export async function buscarAnuncioPorUrl(url: string, accessToken: string): Promise<AnuncioMercadoLivre> {
  const alvo = classificarUrlML(url)
  if (alvo.tipo === 'nenhum') {
    throw new Error('Não encontrei o código do anúncio neste link. Cole o endereço da página do anúncio no Mercado Livre.')
  }
  if (alvo.tipo === 'anuncio') return (await lerItem(alvo.itemId, accessToken)).dados

  // ── CATÁLOGO ──────────────────────────────────────────────────────────
  // 1º o anúncio que o link indica, SE ele for mesmo deste catálogo: é o
  // que a pessoa estava vendo, com preço e descrição do vendedor.
  const indicado = anuncioIndicadoNoLink(url)
  let erroIndicado: unknown = null
  if (indicado) {
    try {
      const { dados, bruto } = await lerItem(indicado, accessToken)
      if (conferirAnuncioDoCatalogo(bruto, alvo.catalogoId)) return dados
    } catch (e) {
      // Ilegível ou inativo: segue para o catálogo. A negativa do ML (403) é
      // guardada para que a tentativa com outra conta da empresa aconteça.
      erroIndicado = e
    }
  }

  // 2º /p/MLB...: o produto do catálogo do ML.
  if (!alvo.catalogoId.startsWith('MLBU')) return lerProdutoCatalogo(alvo.catalogoId, accessToken)

  // 3º /up/MLBU...: produto de um vendedor. Ligado a um produto do catálogo,
  // é esse o conteúdo de referência.
  let up: any = null
  try {
    up = await mlGet(`/user-products/${alvo.catalogoId}`, {}, accessToken)
  } catch { /* o ML costuma não abrir produto de outro vendedor */ }
  if (up?.catalog_product_id) return lerProdutoCatalogo(String(up.catalog_product_id), accessToken)

  if (erroIndicado instanceof Error && /access_denied|forbidden|403/i.test(erroIndicado.message)) throw erroIndicado
  throw new Error(SEM_ANUNCIO_NO_LINK_UP)
}
