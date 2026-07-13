import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getIntegracaoCredentials } from '@/lib/shopee/client'
import { buildPublicBaseString, buildShopBaseString, signRequest } from '@/lib/shopee/signing'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const shopId = searchParams.get('shop_id')
  const state = searchParams.get('state')
  // via=fetch indica que veio pelo processarUrlRetorno (sem redirect)
  const viaFetch = searchParams.get('via') === 'fetch'

  function erro(msg: string, key: string) {
    if (viaFetch) return NextResponse.json({ ok: false, erro: msg }, { status: 400 })
    return NextResponse.redirect(new URL(`/dashboard/marketplaces?erro=${key}`, req.url))
  }

  if (!code || !shopId) return erro('Parâmetros ausentes', 'cancelado')

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return erro('Não autenticado', 'cancelado')

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id

  let partnerId: number, partnerKey: string
  try {
    ;({ partnerId, partnerKey } = await getIntegracaoCredentials(sb))
  } catch {
    return erro('Credenciais não configuradas', 'sem-credenciais')
  }

  const timest = Math.floor(Date.now() / 1000)
  const path = '/api/v2/auth/token/get'

  const sign = signRequest(partnerKey, buildPublicBaseString(partnerId, path, timest))

  const tokenRes = await fetch(`https://partner.shopeemobile.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: partnerId,
      sign,
      timestamp: timest,
    }),
  })
  const tokenData = await tokenRes.json()

  if (tokenData.error || !tokenData.access_token) {
    console.error('Shopee token error:', tokenData)
    return erro(`Erro Shopee: ${tokenData.message ?? tokenData.error}`, 'token-invalido')
  }

  // Busca nome da loja
  const timest2 = Math.floor(Date.now() / 1000)
  const pathShop = '/api/v2/shop/get_shop_info'
  const sign2 = signRequest(partnerKey, buildShopBaseString(partnerId, pathShop, timest2, tokenData.access_token, shopId!))

  const shopRes = await fetch(
    `https://partner.shopeemobile.com${pathShop}?partner_id=${partnerId}&shop_id=${shopId}&access_token=${tokenData.access_token}&timestamp=${timest2}&sign=${sign2}`
  )
  const shopData = await shopRes.json()

  let nome = shopData.response?.shop_name ?? `Shopee ${shopId}`
  let markup = '0'
  try {
    const decoded = JSON.parse(Buffer.from(state ?? '', 'base64url').toString())
    if (decoded.nome) nome = decoded.nome
    if (decoded.markup) markup = decoded.markup
  } catch (_) {}

  // upsert (não insert): reconectar uma loja já vinculada atualiza o token em
  // vez de criar um canal duplicado (uq_canais_empresa_plataforma_seller).
  const { error: canalError } = await sb.from('marketplace_canais').upsert({
    empresa_id: empresaId,
    nome,
    plataforma: 'shopee',
    seller_id: String(shopId),
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_expira_em: new Date(Date.now() + tokenData.expire_in * 1000).toISOString(),
    markup_canal: parseFloat(markup) || 0,
    sincronizar_estoque: true,
    sincronizar_preco: true,
    ativo: true,
  }, { onConflict: 'empresa_id,plataforma,seller_id' })

  if (canalError) return erro(`Erro ao salvar canal: ${canalError.message}`, 'token-invalido')

  if (viaFetch) return NextResponse.json({ ok: true, nome })
  return NextResponse.redirect(new URL('/dashboard/marketplaces?sucesso=shopee', req.url))
}
