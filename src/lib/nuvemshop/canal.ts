import type { NuvemshopChannel } from './types'

/**
 * Colunas de marketplace_canais necessárias para montar um NuvemshopChannel.
 * Fica num lugar só porque quatro rotas pedem exatamente as mesmas — e porque
 * pedir uma coluna a mais que não existe derruba a consulta inteira.
 */
export const COLUNAS_CANAL =
  'id, empresa_id, plataforma, seller_id, access_token, sincronizar_estoque, debitar_estoque_vendas'

export function montarCanal(row: Record<string, any>): NuvemshopChannel {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    storeId: String(row.seller_id),
    accessToken: row.access_token,
    sincronizarEstoque: row.sincronizar_estoque ?? undefined,
    debitarEstoqueVendas: row.debitar_estoque_vendas ?? undefined,
  }
}
