import { nuvemshopGetComTotal, sleep, THROTTLE_MS } from './client'
import type { NuvemshopChannel } from './types'

// Teto da Nuvemshop por página. Usar o máximo reduz o número de chamadas, que
// é o recurso escasso aqui (2 por segundo).
export const PAGE_SIZE = 200

/**
 * Percorre um recurso paginado da Nuvemshop, uma página por vez.
 *
 * A paginação é por número de página, e o total vem no cabeçalho
 * `x-total-count` — não no corpo. Quando o cabeçalho não vem (acontece em
 * algumas respostas), a parada é por página curta: menos itens que o pedido
 * significa que acabou.
 */
export async function* paginar(
  canal: NuvemshopChannel,
  path: string,
  params: Record<string, string | number> = {},
  opts: { pageSize?: number; maxPaginas?: number } = {},
): AsyncGenerator<any[]> {
  const perPage = opts.pageSize ?? PAGE_SIZE
  const maxPaginas = opts.maxPaginas ?? 100
  let page = 1
  let vistos = 0

  while (page <= maxPaginas) {
    const { dados, total } = await nuvemshopGetComTotal(canal, path, { ...params, page, per_page: perPage })
    const lista: any[] = Array.isArray(dados) ? dados : []
    if (lista.length === 0) break

    yield lista
    vistos += lista.length

    // Página incompleta = última página, independente do cabeçalho.
    if (lista.length < perPage) break
    if (total != null && vistos >= total) break

    page += 1
    await sleep(THROTTLE_MS)
  }
}

/** Dados da loja — usado para nomear o canal e testar a conexão. */
export async function getLoja(canal: NuvemshopChannel): Promise<any> {
  const { dados } = await nuvemshopGetComTotal(canal, '/store')
  return dados
}
