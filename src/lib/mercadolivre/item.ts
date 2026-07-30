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

export function extrairItemId(url: string): string | null {
  const match = url.match(/MLB-?(\d+)/i)
  return match ? `MLB${match[1]}` : null
}

export async function buscarAnuncioPorUrl(url: string, accessToken: string): Promise<AnuncioMercadoLivre> {
  const itemId = extrairItemId(url)
  if (!itemId) throw new Error('Não foi possível identificar o anúncio nessa URL. Cole o link completo da página do produto no Mercado Livre.')

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
