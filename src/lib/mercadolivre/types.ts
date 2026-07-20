export type MLCredentials = {
  appId: string
  appSecret: string
}

// Recorte de uma linha de marketplace_canais com o necessário para o sync.
export type MLChannel = {
  id: string
  empresaId: string
  sellerId: string  // user_id do vendedor no Mercado Livre
  accessToken: string
  refreshToken: string
  tokenExpiraEm: string | null
  // Opcionais — só usados no fluxo de pedidos (baixa automática de estoque).
  // Ausentes = comportamento padrão (sempre baixa), mesmo princípio já usado
  // em ShopeeChannel.
  sincronizarEstoque?: boolean
  debitarEstoqueVendas?: boolean
}

export class MLApiError extends Error {
  code?: string
  raw?: unknown
  constructor(message: string, code?: string, raw?: unknown) {
    super(message)
    this.name = 'MLApiError'
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
