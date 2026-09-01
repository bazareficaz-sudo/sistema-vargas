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

export async function buscarAnuncioPorUrl(url: string, accessToken: string): Promise<AnuncioMercadoLivre> {
  const alvo = classificarUrlML(url)
  if (alvo.tipo === 'catalogo') {
    throw new Error(
      'Este link é da página de CATÁLOGO do Mercado Livre, que não pertence a um vendedor — nela vários '
      + 'vendedores disputam a caixa de compra. Abra o anúncio do vendedor específico (o link fica em '
      + '"outras opções de compra" ou no nome do vendedor) e cole aquele endereço.')
  }
  if (alvo.tipo === 'nenhum') {
    throw new Error('Não encontrei o código do anúncio neste link. Cole o endereço da página do anúncio no Mercado Livre.')
  }
  const itemId = alvo.itemId

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

  let categoriaNomeExterna: string | null = null
  let categoriaCaminho: { id: string; name: string }[] = []
  if (item.category_id) {
    try {
      const cat = await mlGet(`/categories/${item.category_id}`, {}, accessToken)
      categoriaNomeExterna = cat?.name ?? null
      // path_from_root já vem do ML na ordem raiz → folha, exatamente o
      // formato que o modal de criar anúncio usa pra exibir o caminho.
      categoriaCaminho = (cat?.path_from_root ?? []).map((c: any) => ({ id: c.id, name: c.name }))
    } catch { /* apenas uma dica de texto — não deve derrubar a importação */ }
  }

  const atributosBrutos: any[] = item.attributes ?? []
  const marcaSugerida = atributosBrutos.find((a: any) => a.id === 'BRAND')?.value_name ?? null
  const imagens: string[] = (item.pictures ?? []).map((p: any) => p.secure_url ?? p.url).filter(Boolean)

  const atributos: AtributoImportado[] = atributosBrutos
    .filter(a => a?.id && a?.value_name && !ATRIBUTOS_NAO_IMPORTAVEIS.has(a.id))
    .map(a => ({ id: a.id, name: a.name ?? a.id, valueName: String(a.value_name) }))

  return {
    titulo: item.title ?? '',
    descricao,
    preco: typeof item.price === 'number' ? item.price : 0,
    imagens,
    categoriaNomeExterna,
    marcaSugerida,
    temVariacoes: Array.isArray(item.variations) && item.variations.length > 0,
    categoriaId: item.category_id ?? null,
    categoriaCaminho,
    atributos,
    condicao: item.condition === 'new' || item.condition === 'used' ? item.condition : null,
  }
}
