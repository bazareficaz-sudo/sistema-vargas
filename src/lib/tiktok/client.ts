import { sign } from './signing'
import { TiktokApiError, type TiktokChannel, type TiktokCredentials } from './types'
import { createAdminClient } from '@/lib/supabase/admin'

const API_BASE = 'https://open-api.tiktokglobalshop.com'
const AUTH_BASE = 'https://auth.tiktok-shops.com'

// Renova o token um pouco antes de expirar, nunca exatamente no limite —
// mesma margem já usada em Shopee/Nuvemshop.
const REFRESH_MARGIN_MS = 30 * 60 * 1000

// app_key/app_secret são credenciais DA PLATAFORMA (o app cadastrado no
// Partner Center), não de uma loja — valem para toda loja conectada. Por
// isso a leitura é sempre feita com a chave de serviço, nunca com a sessão
// do usuário (mesma decisão já tomada em Shopee/Mercado Livre/Nuvemshop).
// O service_id (usado só para montar o link de autorização) fica na coluna
// `extra`, que já existe em sistema_integracoes para isso.
export async function getIntegracaoCredentials(): Promise<TiktokCredentials> {
  const { data: integracao } = await createAdminClient()
    .from('sistema_integracoes')
    .select('app_id, app_secret, extra')
    .eq('plataforma', 'tiktok')
    .single()

  const serviceId = integracao?.extra?.service_id
  if (!integracao?.app_id || !integracao?.app_secret || !serviceId) {
    throw new TiktokApiError('Credenciais da TikTok Shop não configuradas em Configurações → Integrações.')
  }
  return { appKey: integracao.app_id, appSecret: integracao.app_secret, serviceId }
}

function timestamp() {
  return Math.floor(Date.now() / 1000)
}

async function parseResposta(res: Response, path: string) {
  const body = await res.json()
  if (body?.code && body.code !== 0) {
    throw new TiktokApiError(body.message ?? `Erro TikTok Shop em ${path}: código ${body.code}`, body.code, body)
  }
  return body
}

type CallOpts = {
  appKey: string
  appSecret: string
  accessToken?: string
  shopCipher?: string
}

// GET/POST autenticados contra a API da TikTok Shop (open-api.tiktokglobalshop.com).
// A versão do endpoint (ex: 202309, 202502) vai só no path (ex:
// /authorization/202309/shops) — não é parâmetro de query nem entra na
// assinatura. Confirmado na doc oficial "Sign your API request": o exemplo
// de Get Authorized Shops reordena as chaves como só `app_key` e
// `timestamp` (+ `shop_cipher` quando o endpoint exige). O token vai no
// header `x-tts-access-token`, nunca na query nem na assinatura, pra
// versão 202309+ — incluir qualquer um desses dois a mais na query
// assinada foi o que quebrava a assinatura nas tentativas anteriores.
export async function tiktokGet(path: string, params: Record<string, string | number>, opts: CallOpts) {
  const query: Record<string, string | number> = {
    app_key: opts.appKey,
    timestamp: timestamp(),
    ...(opts.shopCipher ? { shop_cipher: opts.shopCipher } : {}),
    ...params,
  }
  const assinatura = sign({ path, query, appSecret: opts.appSecret })
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries({ ...query, sign: assinatura }).map(([k, v]) => [k, String(v)])
    )
  )

  const res = await fetch(`${API_BASE}${path}?${qs.toString()}`, {
    headers: {
      'content-type': 'application/json',
      ...(opts.accessToken ? { 'x-tts-access-token': opts.accessToken } : {}),
    },
  })
  return parseResposta(res, path)
}

export async function tiktokPost(
  path: string,
  body: Record<string, any>,
  opts: CallOpts,
  extraQuery: Record<string, string | number> = {},
) {
  const query: Record<string, string | number> = {
    app_key: opts.appKey,
    timestamp: timestamp(),
    ...(opts.shopCipher ? { shop_cipher: opts.shopCipher } : {}),
    ...extraQuery,
  }
  const bodyStr = JSON.stringify(body ?? {})
  const assinatura = sign({ path, query, body: bodyStr, appSecret: opts.appSecret })
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries({ ...query, sign: assinatura }).map(([k, v]) => [k, String(v)])
    )
  )

  const res = await fetch(`${API_BASE}${path}?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.accessToken ? { 'x-tts-access-token': opts.accessToken } : {}),
    },
    body: bodyStr,
  })
  return parseResposta(res, path)
}

// Troca o auth_code (recebido no retorno do link de autorização) por um
// access_token. Vai em GET, com os parâmetros na própria query — não é
// assinado como as chamadas de API normais (é o próprio endpoint de token).
export async function trocarCodigoPorToken(authCode: string): Promise<{
  accessToken: string
  refreshToken: string
  accessTokenExpireIn: number
  openId: string
  sellerName: string
}> {
  const { appKey, appSecret } = await getIntegracaoCredentials()
  const qs = new URLSearchParams({ app_key: appKey, app_secret: appSecret, auth_code: authCode, grant_type: 'authorized_code' })

  const res = await fetch(`${AUTH_BASE}/api/v2/token/get?${qs.toString()}`)
  const body = await res.json()

  if (body?.code !== 0 || !body?.data?.access_token) {
    throw new TiktokApiError(body?.message ?? 'Falha ao trocar código por token TikTok Shop', body?.code, body)
  }

  return {
    accessToken: body.data.access_token,
    refreshToken: body.data.refresh_token,
    accessTokenExpireIn: body.data.access_token_expire_in,
    openId: body.data.open_id,
    sellerName: body.data.seller_name,
  }
}

// Lista as lojas autorizadas pelo token — é a primeira chamada autenticada
// que fazemos após conectar, tanto para confirmar que o token funciona
// quanto para obter o shop_cipher que toda chamada seguinte exige.
export async function getAuthorizedShops(accessToken: string): Promise<Array<{
  id: string
  cipher: string
  name?: string
  region?: string
  code?: string
}>> {
  const { appKey, appSecret } = await getIntegracaoCredentials()
  const data = await tiktokGet('/authorization/202309/shops', {}, { appKey, appSecret, accessToken })
  const shops = data?.data?.shops ?? []
  return shops.map((s: any) => ({
    id: String(s.id ?? s.shop_id ?? ''),
    cipher: s.cipher ?? s.shop_cipher ?? '',
    name: s.name ?? s.shop_name,
    region: s.region,
    code: s.code ?? s.shop_code,
  }))
}

// Garante um access_token válido para o canal, renovando via refresh_token
// quando estiver perto de expirar. Deve ser chamado antes de qualquer
// chamada autenticada.
export async function refreshAccessTokenIfNeeded(sb: any, canal: TiktokChannel): Promise<TiktokChannel> {
  const expiraEm = canal.tokenExpiraEm ? new Date(canal.tokenExpiraEm).getTime() : 0
  const precisaRenovar = !canal.tokenExpiraEm || expiraEm - Date.now() < REFRESH_MARGIN_MS
  if (!precisaRenovar) return canal

  const { appKey, appSecret } = await getIntegracaoCredentials()
  const qs = new URLSearchParams({
    app_key: appKey, app_secret: appSecret,
    refresh_token: canal.refreshToken ?? '', grant_type: 'refresh_token',
  })

  const res = await fetch(`${AUTH_BASE}/api/v2/token/refresh?${qs.toString()}`)
  const body = await res.json()

  if (body?.code !== 0 || !body?.data?.access_token) {
    throw new TiktokApiError('Falha ao renovar token TikTok Shop — reconecte a loja em Marketplaces.', body?.code, body)
  }

  const tokenExpiraEm = new Date(Date.now() + (body.data.access_token_expire_in ?? 0) * 1000).toISOString()

  await sb.from('marketplace_canais').update({
    access_token: body.data.access_token,
    refresh_token: body.data.refresh_token ?? canal.refreshToken,
    token_expira_em: tokenExpiraEm,
    updated_at: new Date().toISOString(),
  }).eq('id', canal.id)

  return {
    ...canal,
    accessToken: body.data.access_token,
    refreshToken: body.data.refresh_token ?? canal.refreshToken,
    tokenExpiraEm,
  }
}
