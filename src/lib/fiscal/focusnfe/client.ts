import { FiscalProviderError } from '../types'

const BASE_PRODUCAO = 'https://api.focusnfe.com.br/v2'
const BASE_HOMOLOGACAO = 'https://homologacao.focusnfe.com.br/v2'

export type FocusCredentials = { token: string; ambiente: 'producao' | 'homologacao' }

function baseUrl(ambiente: 'producao' | 'homologacao') {
  return ambiente === 'homologacao' ? BASE_HOMOLOGACAO : BASE_PRODUCAO
}

function authHeader(token: string) {
  return 'Basic ' + Buffer.from(token + ':').toString('base64')
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

// Retorna o texto cru (pode ser JSON ou XML, dependendo do endpoint — quem
// chama decide como parsear) junto do status HTTP, pra quem chama poder
// decidir o que fazer com um erro específico da Focus.
export async function focusRequest(
  creds: FocusCredentials,
  path: string,
  opts: { method?: string; body?: any; query?: Record<string, string> } = {}
): Promise<{ status: number; text: string; contentType: string }> {
  const url = new URL(`${baseUrl(creds.ambiente)}${path}`)
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)

  let resp: Response
  try {
    resp = await fetchWithTimeout(url.toString(), {
      method: opts.method ?? 'GET',
      headers: {
        'Authorization': authHeader(creds.token),
        'Content-Type': 'application/json',
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch (e: any) {
    const timeout = e?.name === 'AbortError'
    throw new FiscalProviderError(
      timeout ? 'Tempo esgotado ao conectar com a Focus NFe' : `Erro de rede ao conectar com a Focus NFe: ${e?.message ?? e}`,
      timeout ? 'timeout' : 'rede'
    )
  }

  const text = await resp.text()
  return { status: resp.status, text, contentType: resp.headers.get('Content-Type') ?? 'application/json' }
}

// Helper pros endpoints que sempre respondem JSON (emissão/consulta/
// cancelamento) — lança FiscalProviderError com a mensagem da Focus quando
// o status não é de sucesso, em vez de devolver um JSON de erro pro chamador
// tratar na mão toda vez.
export async function focusRequestJson(creds: FocusCredentials, path: string, opts: { method?: string; body?: any; query?: Record<string, string> } = {}): Promise<any> {
  const { status, text } = await focusRequest(creds, path, opts)
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Focus NFe (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }
  if (status >= 400) {
    const mensagem = json?.mensagem ?? json?.erro ?? json?.message ?? `Erro ${status} na Focus NFe`
    throw new FiscalProviderError(mensagem, 'focus_erro', json)
  }
  return json
}
