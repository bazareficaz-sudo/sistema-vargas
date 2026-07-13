import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getIntegracaoCredentials, shopeeGet, shopeePost } from '@/lib/shopee/client'
import { ShopeeApiError } from '@/lib/shopee/types'

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

  // Troca o código de autorização por um access_token. A Shopee exige
  // partner_id/timestamp/sign também na query string (não só no corpo),
  // mesmo em POST — sem isso ela responde "There is no partner_id in query".
  let tokenData: any
  try {
    tokenData = await shopeePost(
      '/api/v2/auth/token/get',
      { code, shop_id: Number(shopId), partner_id: partnerId },
      { partnerId, partnerKey }
    )
  } catch (e) {
    const msg = e instanceof ShopeeApiError ? e.message : 'Erro ao trocar código por token'
    console.error('Shopee token error:', e)
    return erro(`Erro Shopee: ${msg}`, 'token-invalido')
  }

  if (!tokenData.access_token) {
    console.error('Shopee token error:', tokenData)
    return erro(`Erro Shopee: ${tokenData.message ?? 'access_token ausente na resposta'}`, 'token-invalido')
  }

  // Busca nome da loja
  let shopData: any = {}
  try {
    shopData = await shopeeGet(
      '/api/v2/shop/get_shop_info',
      {},
      { partnerId, partnerKey, accessToken: tokenData.access_token, shopId: String(shopId) }
    )
  } catch (e) {
    console.error('Shopee get_shop_info error:', e)
  }

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
