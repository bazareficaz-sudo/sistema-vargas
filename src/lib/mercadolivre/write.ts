import { mlPut, refreshAccessTokenIfNeeded } from './client'
import { MLApiError, type MLChannel } from './types'

// Atualização de anúncio já existente no Mercado Livre — mesmo endpoint
// pra tudo (PUT /items/{id} com corpo parcial), diferente da Shopee que
// separa update_price/update_stock/unlist_item em três chamadas.

export type ResultadoAtualizarML = { ok: boolean; erro?: string }

async function atualizarItem(sb: any, canalInicial: MLChannel, itemId: string, body: Record<string, any>): Promise<ResultadoAtualizarML> {
  try {
    const canal = await refreshAccessTokenIfNeeded(sb, canalInicial)
    await mlPut(`/items/${itemId}`, body, canal.accessToken)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, erro: e instanceof MLApiError ? e.message : (e?.message ?? 'Erro ao atualizar anúncio no Mercado Livre') }
  }
}

export async function atualizarPrecoEstoque(
  sb: any, canal: MLChannel, itemId: string, alvo: { preco?: number; estoque?: number }
): Promise<ResultadoAtualizarML> {
  const body: Record<string, any> = {}
  if (alvo.preco != null) body.price = alvo.preco
  if (alvo.estoque != null) body.available_quantity = alvo.estoque
  if (Object.keys(body).length === 0) return { ok: true }
  return atualizarItem(sb, canal, itemId, body)
}

export type AlvoVariacaoML = { variationId: string; preco?: number; estoque?: number }

/**
 * Preço e estoque de VARIAÇÕES de um anúncio.
 *
 * Num item com variações, `available_quantity` no nível do item é derivado —
 * a quantidade mora em cada `variations[].available_quantity`, e é por isso
 * que `atualizarPrecoEstoque` não serve aqui: ele mandaria um número só para
 * o item e o Mercado Livre recusaria (ou, pior, redistribuiria).
 *
 * MANDA SÓ AS VARIAÇÕES INFORMADAS. O `id` de cada uma é o endereço dela no
 * anúncio; as que não entram na lista ficam como estão. É essa propriedade
 * que deixa sincronizar um anúncio parcialmente mapeado sem destruir a
 * distribuição que o vendedor fez no resto.
 */
export function corpoDeVariacoes(variacoes: AlvoVariacaoML[]): { variations: Record<string, any>[] } | null {
  const lista = variacoes
    .filter(v => v.variationId && (v.preco != null || v.estoque != null))
    .map(v => ({
      id: Number(v.variationId),
      ...(v.estoque != null ? { available_quantity: v.estoque } : {}),
      ...(v.preco != null ? { price: v.preco } : {}),
    }))

  return lista.length === 0 ? null : { variations: lista }
}

export async function atualizarVariacoes(
  sb: any, canal: MLChannel, itemId: string, variacoes: AlvoVariacaoML[],
): Promise<ResultadoAtualizarML> {
  const corpo = corpoDeVariacoes(variacoes)
  if (!corpo) return { ok: true }
  return atualizarItem(sb, canal, itemId, corpo)
}

export function pausarAnuncio(sb: any, canal: MLChannel, itemId: string): Promise<ResultadoAtualizarML> {
  return atualizarItem(sb, canal, itemId, { status: 'paused' })
}

export function reativarAnuncio(sb: any, canal: MLChannel, itemId: string): Promise<ResultadoAtualizarML> {
  return atualizarItem(sb, canal, itemId, { status: 'active' })
}

export function encerrarAnuncio(sb: any, canal: MLChannel, itemId: string): Promise<ResultadoAtualizarML> {
  return atualizarItem(sb, canal, itemId, { status: 'closed' })
}
