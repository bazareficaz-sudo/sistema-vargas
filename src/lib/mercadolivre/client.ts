import { MLApiError, type MLChannel, type MLCredentials } from './types'

const API_BASE = 'https://api.mercadolibre.com'

// Renova o token um pouco antes de expirar, nunca exatamente no limite.
// Access token do ML dura 6h (expires_in ~21600s).
const REFRESH_MARGIN_MS = 30 * 60 * 1000

export async function getIntegracaoCredentials(sb: any): Promise<MLCredentials> {
  const { data: integracao } = await sb
    .from('sistema_integracoes')
    .select('app_id, app_secret')
    .eq('plataforma', 'mercadolivre')
    .single()

  if (!integracao?.app_id || !integracao?.app_secret) {
    throw new MLApiError('Credenciais do Mercado Livre não configuradas em Configurações → Integrações.')
  }
  return { appId: integracao.app_id, appSecret: integracao.app_secret }
}

// O erro genérico do ML (ex: "body.required_fields") só diz o TIPO do
// problema — os campos específicos que faltam/estão errados vêm no array
// `cause`. Sem isso, o usuário só vê um código sem sentido; formatamos aqui
// pra virar uma mensagem acionável. Formato de cada item de `cause` varia
// (nem sempre tem `message`), então tenta várias chaves com fallback.
function formatarCausaML(cause: unknown): string | null {
  if (!Array.isArray(cause) || cause.length === 0) return null
  const partes = cause.map((c: any) => {
    if (typeof c === 'string') return c
    const campo = c?.references?.attribute_id ?? c?.attribute_id ?? c?.code ?? null
    const texto = c?.message ?? c?.description ?? null
    if (texto && campo && !String(texto).includes(String(campo))) return `${campo}: ${texto}`
    return texto ?? campo ?? null
  }).filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : null
}

async function parseMLResponse(res: Response, path: string) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detalheCausa = formatarCausaML(body?.cause)
    const base = body?.message ?? `Erro Mercado Livre em ${path} (status ${res.status})`
    const mensagem = detalheCausa ? `${base} — ${detalheCausa}` : base
    throw new MLApiError(mensagem, body?.error, body)
  }
  return body
}

export async function mlGet(path: string, params: Record<string, string | number>, accessToken: string) {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])))
  const url = `${API_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ''}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  return parseMLResponse(res, path)
}

export async function mlPost(path: string, body: unknown, accessToken: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseMLResponse(res, path)
}

export async function mlPut(path: string, body: unknown, accessToken: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseMLResponse(res, path)
}

// Garante um access_token válido para o canal, renovando via refresh_token
// quando estiver perto de expirar. O ML rotaciona o refresh_token a cada
// uso — sempre persiste o novo, o antigo deixa de funcionar.
export async function refreshAccessTokenIfNeeded(sb: any, canal: MLChannel): Promise<MLChannel> {
  const expiraEm = canal.tokenExpiraEm ? new Date(canal.tokenExpiraEm).getTime() : 0
  const precisaRenovar = !canal.tokenExpiraEm || expiraEm - Date.now() < REFRESH_MARGIN_MS

  if (!precisaRenovar) return canal

  const { appId, appSecret } = await getIntegracaoCredentials(sb)

  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: appId,
      client_secret: appSecret,
      refresh_token: canal.refreshToken,
    }),
  })
  const data = await parseMLResponse(res, '/oauth/token')

  if (!data.access_token) {
    throw new MLApiError('Falha ao renovar token do Mercado Livre — reconecte a loja em Marketplaces.', undefined, data)
  }

  const tokenExpiraEm = new Date(Date.now() + (data.expires_in ?? 0) * 1000).toISOString()

  await sb.from('marketplace_canais').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? canal.refreshToken,
    token_expira_em: tokenExpiraEm,
    updated_at: new Date().toISOString(),
  }).eq('id', canal.id)

  return {
    ...canal,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? canal.refreshToken,
    tokenExpiraEm,
  }
}
