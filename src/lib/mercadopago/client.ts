const BASE_URL = 'https://api.mercadopago.com'

export class MercadoPagoError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Sempre server-side — a conta Mercado Pago é da própria Vargas Sistema
// (recebe as mensalidades de todos os clientes), não por empresa/tenant.
export async function mpRequest(method: 'GET' | 'POST' | 'PUT', path: string, body?: any): Promise<any> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) throw new MercadoPagoError('MERCADOPAGO_ACCESS_TOKEN não configurado')

  let resp: Response
  try {
    resp = await fetchWithTimeout(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e: any) {
    const timeout = e?.name === 'AbortError'
    throw new MercadoPagoError(timeout ? 'Tempo esgotado ao conectar com o Mercado Pago' : `Erro de rede ao conectar com o Mercado Pago: ${e?.message ?? e}`)
  }

  const text = await resp.text()
  let json: any
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }

  if (!resp.ok) {
    throw new MercadoPagoError(json?.message ?? `Erro ${resp.status} na API do Mercado Pago: ${text}`, resp.status)
  }
  return json
}
