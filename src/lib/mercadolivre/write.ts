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

export function pausarAnuncio(sb: any, canal: MLChannel, itemId: string): Promise<ResultadoAtualizarML> {
  return atualizarItem(sb, canal, itemId, { status: 'paused' })
}

export function reativarAnuncio(sb: any, canal: MLChannel, itemId: string): Promise<ResultadoAtualizarML> {
  return atualizarItem(sb, canal, itemId, { status: 'active' })
}

export function encerrarAnuncio(sb: any, canal: MLChannel, itemId: string): Promise<ResultadoAtualizarML> {
  return atualizarItem(sb, canal, itemId, { status: 'closed' })
}
