import { tiktokGet, tiktokPost, getIntegracaoCredentials } from './client'
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
      { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher },
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

/**
 * Detalhe completo de um produto — confirmado ao vivo que Search Products
 * (paginarProdutos acima) NÃO devolve `main_images` de jeito nenhum, só
 * id/título/skus/preço/estoque. Get Product é a única forma de obter a
 * imagem, mas só aceita um product_id por chamada (sem lote), então é
 * usado como busca extra por produto — não como fonte principal — pra não
 * multiplicar por 2 o número de chamadas quando a imagem não é o que
 * falhou.
 */
export async function getDetalheProduto(canal: TiktokChannel, productId: string): Promise<TiktokProduct | null> {
  const { appKey, appSecret } = await getIntegracaoCredentials()
  const resp = await tiktokGet(
    `/product/202309/products/${productId}`,
    {},
    { appKey, appSecret, accessToken: canal.accessToken, shopCipher: canal.shopCipher },
  )
  return resp?.data ?? null
}

/** Loja(s) autorizada(s) pelo token — usado para nomear o canal e obter o shop_cipher. */
export { getAuthorizedShops as getLojasAutorizadas } from './client'
