export type ShopeeCredentials = {
  partnerId: number
  partnerKey: string
}

// Recorte de uma linha de marketplace_canais com o necessário para o sync.
export type ShopeeChannel = {
  id: string
  empresaId: string
  sellerId: string
  accessToken: string
  refreshToken: string
  tokenExpiraEm: string | null
}

export class ShopeeApiError extends Error {
  code?: string
  raw?: unknown
  constructor(message: string, code?: string, raw?: unknown) {
    super(message)
    this.name = 'ShopeeApiError'
    this.code = code
    this.raw = raw
  }
}

// Tipos frouxos de propósito: os nomes de campo exatos da resposta da Shopee
// não foram 100% confirmados contra a documentação oficial (indisponível no
// momento da implementação). Usar `any` com campos conhecidos comentados
// evita que o sync quebre por causa do sistema de tipos enquanto o mapeamento
// real é validado contra `dados_brutos` na primeira sincronização real.
export type ShopeeItemBaseInfo = {
  item_id: number | string
  item_name?: string
  description?: string
  image?: { image_url_list?: string[] }
  category_id?: number
  brand?: { brand_id?: number; original_brand_name?: string }
  weight?: string | number
  item_status?: string
  update_time?: number
  price_info?: Array<{ current_price?: number; original_price?: number }>
  stock_info_v2?: { summary_info?: { total_available_stock?: number } }
  has_model?: boolean
  [key: string]: unknown
}

export type ShopeeModel = {
  model_id: number | string
  model_name?: string
  model_sku?: string
  price_info?: Array<{ current_price?: number }>
  stock_info_v2?: { summary_info?: { total_available_stock?: number } }
  [key: string]: unknown
}

export type SyncFailure = { itemId: string; error: string }

export type SyncResult = {
  totalFound: number
  upserted: number
  failed: SyncFailure[]
  truncated: boolean
}
