import type { TiktokChannel } from './types'

// Colunas de marketplace_canais necessárias para montar um TiktokChannel.
// Mesmo princípio de Shopee/Nuvemshop: um lugar só, porque pedir uma coluna
// a mais que não existe derruba a consulta inteira.
export const COLUNAS_CANAL =
  'id, empresa_id, plataforma, seller_id, shop_cipher, access_token, refresh_token, token_expira_em, sincronizar_estoque, debitar_estoque_vendas'

export function montarCanal(row: Record<string, any>): TiktokChannel {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    sellerId: String(row.seller_id ?? ''),
    shopCipher: row.shop_cipher ?? '',
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? null,
    tokenExpiraEm: row.token_expira_em ?? null,
    sincronizarEstoque: row.sincronizar_estoque ?? undefined,
    debitarEstoqueVendas: row.debitar_estoque_vendas ?? undefined,
  }
}
