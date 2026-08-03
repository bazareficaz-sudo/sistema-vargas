export type NuvemshopCredentials = {
  appId: string
  appSecret: string
}

// Recorte de uma linha de marketplace_canais com o necessário para o sync.
//
// Diferente de Shopee e Mercado Livre, aqui NÃO existe refresh_token nem
// validade: o token da Nuvemshop não expira. Ele só deixa de valer se outro
// for gerado ou se o lojista desinstalar o app. Por isso o canal não carrega
// tokenExpiraEm — não haveria o que renovar.
export type NuvemshopChannel = {
  id: string
  empresaId: string
  /** store_id da loja na Nuvemshop — vai na URL de toda chamada. */
  storeId: string
  accessToken: string
  // Opcionais — só usados no fluxo de pedidos (baixa automática de estoque).
  // Ausentes = comportamento padrão (sempre baixa), mesmo princípio já usado
  // em ShopeeChannel e MLChannel.
  sincronizarEstoque?: boolean
  debitarEstoqueVendas?: boolean
}

export class NuvemshopApiError extends Error {
  status?: number
  raw?: unknown
  constructor(message: string, status?: number, raw?: unknown) {
    super(message)
    this.name = 'NuvemshopApiError'
    this.status = status
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

/**
 * Campos de texto da Nuvemshop vêm por idioma (`{ pt: "Camiseta", es: "..." }`),
 * mas nem toda resposta respeita isso — às vezes vem string simples. Resolver
 * isso num lugar só evita espalhar o mesmo tratamento defensivo por todo
 * mapeamento.
 */
export function textoLocalizado(valor: unknown, idiomaPreferido = 'pt'): string | null {
  if (valor == null) return null
  if (typeof valor === 'string') return valor.trim() || null
  if (typeof valor !== 'object') return null

  const mapa = valor as Record<string, unknown>
  const preferido = mapa[idiomaPreferido]
  if (typeof preferido === 'string' && preferido.trim()) return preferido.trim()

  // Loja pode estar configurada em outro idioma — pega o primeiro texto real
  // em vez de devolver vazio.
  for (const v of Object.values(mapa)) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}
