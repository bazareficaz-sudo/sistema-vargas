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
  sincronizarEstoque?: boolean
  debitarEstoqueVendas?: boolean
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

// Tipo frouxo de propósito, mesmo princípio do TiktokProduct: o JSON de
// exemplo da doc oficial (Get Order List / Get Order Detail) não renderizou
// em texto simples no momento da implementação, então os nomes de campo
// abaixo seguem o formato já estabilizado e público da TikTok Shop Order
// API (payment/recipient_address/line_items), não uma cópia literal
// confirmada. O mapeamento em pedidos.ts é defensivo e guarda o payload
// bruto em `dados_brutos` para corrigir contra dados reais se necessário.
export type TiktokOrder = {
  id: string | number
  status?: string
  create_time?: number
  update_time?: number
  rts_time?: number
  payment?: {
    currency?: string
    sub_total?: string
    shipping_fee?: string
    seller_discount?: string
    platform_discount?: string
    total_amount?: string
  }
  recipient_address?: {
    name?: string
    phone_number?: string
    full_address?: string
    address_line1?: string
    address_line2?: string
    address_line3?: string
    district?: string
    city?: string
    town?: string
    state?: string
    postal_code?: string
  }
  line_items?: Array<{
    id?: string | number
    product_id?: string | number
    product_name?: string
    sku_id?: string | number
    seller_sku?: string
    sale_price?: string
    quantity?: number
  }>
  tracking_number?: string
  [key: string]: unknown
}
