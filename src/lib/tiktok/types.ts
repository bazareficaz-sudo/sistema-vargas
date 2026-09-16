export type TiktokCredentials = {
  appKey: string
  appSecret: string
  serviceId: string
}

// Recorte de uma linha de marketplace_canais com o necessário para chamar a
// API em nome de uma loja conectada.
export type TiktokChannel = {
  id: string
  empresaId: string
  sellerId: string // open_id/shop_id devolvido pela TikTok
  shopCipher: string
  accessToken: string
  refreshToken: string | null
  tokenExpiraEm: string | null
}

export class TiktokApiError extends Error {
  code?: number
  raw?: unknown
  constructor(message: string, code?: number, raw?: unknown) {
    super(message)
    this.name = 'TiktokApiError'
    this.code = code
    this.raw = raw
  }
}

export type SyncFailure = { itemId: string; error: string }

export type SyncResult = {
  totalFound: number
  upserted: number
  failed: SyncFailure[]
  truncated: boolean
}

// Tipo frouxo de propósito, mesmo princípio já usado em Shopee/Nuvemshop: os
// nomes de campo exatos da resposta de Search Products não puderam ser 100%
// confirmados contra um exemplo real (a documentação oficial não renderiza o
// JSON de exemplo em texto simples). O mapeamento em sync.ts é defensivo —
// gera aviso em vez de quebrar quando um campo esperado não aparece, e
// sempre guarda o payload bruto em `dados_brutos` para corrigir o
// mapeamento contra dados reais na primeira sincronização de verdade.
export type TiktokProduct = {
  id: string | number
  title?: string
  status?: string
  create_time?: number
  update_time?: number
  main_images?: Array<{ uri?: string; url?: string; urls?: string[] }>
  skus?: Array<{
    id?: string | number
    seller_sku?: string
    price?: { tax_exclusive_price?: string; sale_price?: string; currency?: string }
    inventory?: Array<{ warehouse_id?: string; quantity?: number }>
  }>
  [key: string]: unknown
}
