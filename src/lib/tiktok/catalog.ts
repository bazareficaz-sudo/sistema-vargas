import { tiktokPost, getIntegracaoCredentials } from './client'
import type { TiktokChannel, TiktokProduct } from './types'

export const PAGE_SIZE = 100 // teto aceito pela API (1-100)

/**
 * Percorre o catálogo da loja via Search Products, uma página por vez.
 *
 * A paginação da TikTok Shop é por `page_token` opaco (devolvido como
 * `next_page_token`), não por número de página — segue enquanto vier um
 * token novo e a página não vier vazia. `page_size`/`page_token` vão na
 * query string (não no corpo) — só o filtro (`status`) vai no corpo.
 */
export async function* paginarProdutos(
  canal: TiktokChannel,
  opts: { pageSize?: number; maxPaginas?: number } = {},
): AsyncGenerator<TiktokProduct[]> {
  const { appKey, appSecret } = await getIntegracaoCredentials()
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const maxPaginas = opts.maxPaginas ?? 100

  let pageToken: string | undefined
  let pagina = 0

  while (pagina < maxPaginas) {
    const extraQuery: Record<string, string | number> = { page_size: pageSize }
    if (pageToken) extraQuery.page_token = pageToken

    const resp = await tiktokPost(
      '/product/202502/products/search',
      { status: 'ALL' },
      { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher, version: '202502' },
      extraQuery,
    )

    const produtos: TiktokProduct[] = resp?.data?.products ?? []
    if (produtos.length === 0) break

    yield produtos

    const proximo = resp?.data?.next_page_token
    if (!proximo || produtos.length < pageSize) break
    pageToken = proximo
    pagina += 1
  }
}

/** Loja(s) autorizada(s) pelo token — usado para nomear o canal e obter o shop_cipher. */
export { getAuthorizedShops as getLojasAutorizadas } from './client'
