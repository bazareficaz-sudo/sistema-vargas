import { buildPublicBaseString, buildShopBaseString, signRequest } from './signing'
import { ShopeeApiError, type ShopeeChannel, type ShopeeCredentials } from './types'
import { createAdminClient } from '@/lib/supabase/admin'

const API_BASE = 'https://partner.shopeemobile.com'

// Renova o token um pouco antes de expirar, nunca exatamente no limite.
const REFRESH_MARGIN_MS = 30 * 60 * 1000

// A partner_key da Shopee é credencial DA PLATAFORMA, não do cliente: é ela
// que assina toda chamada de todas as lojas conectadas. Por isso a leitura é
// sempre feita com a chave de serviço, e a tabela fica fechada para qualquer
// sessão de usuário — nem o dono da loja precisa (ou deve) ver esse valor.
//
// O parâmetro `sb` continua na assinatura só para não mexer nas dezenas de
// chamadas existentes; ele é deliberadamente ignorado aqui.
export async function getIntegracaoCredentials(_sb?: any): Promise<ShopeeCredentials> {
  const { data: integracao } = await createAdminClient()
    .from('sistema_integracoes')
    .select('partner_id, partner_key')
    .eq('plataforma', 'shopee')
    .single()

  if (!integracao?.partner_id || !integracao?.partner_key) {
    throw new ShopeeApiError('Credenciais Shopee não configuradas em Configurações → Integrações.')
  }
  return { partnerId: Number(integracao.partner_id), partnerKey: integracao.partner_key }
}

type CallOpts = {
  partnerId: number
  partnerKey: string
  accessToken?: string
  shopId?: string
}

function timestamp() {
  return Math.floor(Date.now() / 1000)
}

async function parseShopeeResponse(res: Response, path: string) {
  const body = await res.json()
  if (body?.error) {
    throw new ShopeeApiError(body.message ?? `Erro Shopee em ${path}: ${body.error}`, body.error, body)
  }
  return body
}

export async function shopeeGet(path: string, params: Record<string, string | number>, opts: CallOpts) {
  const ts = timestamp()
  const baseStr = opts.accessToken
    ? buildShopBaseString(opts.partnerId, path, ts, opts.accessToken, opts.shopId ?? '')
    : buildPublicBaseString(opts.partnerId, path, ts)
  const sign = signRequest(opts.partnerKey, baseStr)

  const qs = new URLSearchParams({
    partner_id: String(opts.partnerId),
    timestamp: String(ts),
    sign,
    ...(opts.accessToken ? { access_token: opts.accessToken, shop_id: String(opts.shopId ?? '') } : {}),
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })

  const res = await fetch(`${API_BASE}${path}?${qs.toString()}`)
  return parseShopeeResponse(res, path)
}

export async function shopeePost(path: string, body: Record<string, any>, opts: CallOpts) {
  const ts = timestamp()
  const baseStr = opts.accessToken
    ? buildShopBaseString(opts.partnerId, path, ts, opts.accessToken, opts.shopId ?? '')
    : buildPublicBaseString(opts.partnerId, path, ts)
  const sign = signRequest(opts.partnerKey, baseStr)

  const qs = new URLSearchParams({
    partner_id: String(opts.partnerId),
    timestamp: String(ts),
    sign,
    ...(opts.accessToken ? { access_token: opts.accessToken, shop_id: String(opts.shopId ?? '') } : {}),
  })

  const res = await fetch(`${API_BASE}${path}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseShopeeResponse(res, path)
}

// upload_image (media_space) é o único endpoint conhecido desta integração
// que exige multipart/form-data em vez de JSON — o corpo já vem pronto como
// FormData (contendo o arquivo + campos como `scene`), sem Content-Type
// manual (o fetch define o boundary sozinho). Mesmo tratamento defensivo de
// erro dos outros métodos: a Shopee sempre responde em JSON aqui.
export async function shopeeUploadImage(path: string, formData: FormData, opts: CallOpts) {
  const ts = timestamp()
  const baseStr = opts.accessToken
    ? buildShopBaseString(opts.partnerId, path, ts, opts.accessToken, opts.shopId ?? '')
    : buildPublicBaseString(opts.partnerId, path, ts)
  const sign = signRequest(opts.partnerKey, baseStr)

  const qs = new URLSearchParams({
    partner_id: String(opts.partnerId),
    timestamp: String(ts),
    sign,
    ...(opts.accessToken ? { access_token: opts.accessToken, shop_id: String(opts.shopId ?? '') } : {}),
  })

  const res = await fetch(`${API_BASE}${path}?${qs.toString()}`, { method: 'POST', body: formData })
  return parseShopeeResponse(res, path)
}

// download_shipping_document é o único endpoint conhecido desta integração
// que foge do padrão JSON — devolve o PDF em bytes crus. Se a Shopee
// retornar um erro em vez do documento, o content-type vem como JSON;
// nesse caso faz o parse normal e lança, em vez de devolver "bytes de erro".
export async function shopeePostBinary(path: string, body: Record<string, any>, opts: CallOpts): Promise<ArrayBuffer> {
  const ts = timestamp()
  const baseStr = opts.accessToken
    ? buildShopBaseString(opts.partnerId, path, ts, opts.accessToken, opts.shopId ?? '')
    : buildPublicBaseString(opts.partnerId, path, ts)
  const sign = signRequest(opts.partnerKey, baseStr)

  const qs = new URLSearchParams({
    partner_id: String(opts.partnerId),
    timestamp: String(ts),
    sign,
    ...(opts.accessToken ? { access_token: opts.accessToken, shop_id: String(opts.shopId ?? '') } : {}),
  })

  const res = await fetch(`${API_BASE}${path}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    await parseShopeeResponse(res, path) // sempre lança — resposta JSON aqui só ocorre em erro
    throw new ShopeeApiError(`Resposta inesperada (JSON) em ${path}`)
  }
  return res.arrayBuffer()
}

// Garante um access_token válido para o canal, renovando via refresh_token
// quando estiver perto de expirar. Deve ser chamado antes de qualquer
// chamada autenticada (get_item_list, get_item_base_info, get_model_list,
// get_shop_info).
export async function refreshAccessTokenIfNeeded(sb: any, canal: ShopeeChannel): Promise<ShopeeChannel> {
  const expiraEm = canal.tokenExpiraEm ? new Date(canal.tokenExpiraEm).getTime() : 0
  const precisaRenovar = !canal.tokenExpiraEm || expiraEm - Date.now() < REFRESH_MARGIN_MS

  if (!precisaRenovar) return canal

  const { partnerId, partnerKey } = await getIntegracaoCredentials(sb)
  const path = '/api/v2/auth/access_token/get'

  const data = await shopeePost(
    path,
    { refresh_token: canal.refreshToken, partner_id: partnerId, shop_id: Number(canal.sellerId) },
    { partnerId, partnerKey }
  )

  if (!data.access_token) {
    throw new ShopeeApiError('Falha ao renovar token Shopee — reconecte a loja em Configurações.', undefined, data)
  }

  const tokenExpiraEm = new Date(Date.now() + (data.expire_in ?? 0) * 1000).toISOString()

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
