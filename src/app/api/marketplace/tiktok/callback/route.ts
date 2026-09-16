import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { trocarCodigoPorToken, getAuthorizedShops } from '@/lib/tiktok/client'
import { TiktokApiError } from '@/lib/tiktok/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  // via=fetch indica que veio pelo processarUrlRetorno da tela (colar URL
  // manualmente) em vez de redirect de navegador — mesmo mecanismo da
  // Shopee, necessário porque em dev o retorno vai sempre para produção.
  const viaFetch = searchParams.get('via') === 'fetch'

  function erro(msg: string, key: string) {
    if (viaFetch) return NextResponse.json({ ok: false, erro: msg }, { status: 400 })
    return NextResponse.redirect(new URL(`/dashboard/marketplaces?erro=${key}`, req.url))
  }

  if (!code) return erro('Parâmetros ausentes', 'cancelado')

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return erro('Não autenticado', 'cancelado')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return erro('Empresa não identificada', 'sem-empresa')

  let tokenData: Awaited<ReturnType<typeof trocarCodigoPorToken>>
  try {
    tokenData = await trocarCodigoPorToken(code)
  } catch (e) {
    const msg = e instanceof TiktokApiError ? e.message : 'Erro ao trocar código por token'
    console.error('TikTok Shop token error:', e)
    return erro(`Erro TikTok Shop: ${msg}`, 'token-invalido')
  }

  // Get Authorized Shops além de confirmar que o token funciona, é de onde
  // sai o shop_cipher — exigido em toda chamada de API seguinte.
  let shopId = tokenData.openId
  let shopCipher = ''
  let nomeLoja = tokenData.sellerName || `TikTok Shop ${tokenData.openId}`
  try {
    const lojas = await getAuthorizedShops(tokenData.accessToken)
    if (lojas[0]) {
      shopId = lojas[0].id || shopId
      shopCipher = lojas[0].cipher
      nomeLoja = lojas[0].name || nomeLoja
    }
  } catch (e) {
    console.error('TikTok Shop get_authorized_shops error:', e)
    return erro('Não foi possível confirmar a loja autorizada — tente novamente.', 'token-invalido')
  }

  let nome = nomeLoja
  let markup = '0'
  try {
    const decoded = JSON.parse(Buffer.from(state ?? '', 'base64url').toString())
    if (decoded.nome) nome = decoded.nome
    if (decoded.markup) markup = decoded.markup
  } catch { /* state ausente ou corrompido não impede conectar */ }

  // upsert (não insert): reconectar uma loja já vinculada atualiza o token
  // em vez de criar um canal duplicado — mesma chave já usada por
  // Shopee/Mercado Livre/Nuvemshop.
  const { error: canalError } = await sb.from('marketplace_canais').upsert({
    empresa_id: empresaId,
    nome,
    plataforma: 'tiktok',
    seller_id: shopId,
    shop_cipher: shopCipher,
    access_token: tokenData.accessToken,
    refresh_token: tokenData.refreshToken,
    token_expira_em: new Date(Date.now() + tokenData.accessTokenExpireIn * 1000).toISOString(),
    markup_canal: parseFloat(markup) || 0,
    sincronizar_estoque: true,
    sincronizar_preco: true,
    ativo: true,
  }, { onConflict: 'empresa_id,plataforma,seller_id' })

  if (canalError) return erro(`Erro ao salvar canal: ${canalError.message}`, 'token-invalido')

  if (viaFetch) return NextResponse.json({ ok: true, nome })
  return NextResponse.redirect(new URL('/dashboard/marketplaces?sucesso=tiktok', req.url))
}
