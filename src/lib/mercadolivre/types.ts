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
