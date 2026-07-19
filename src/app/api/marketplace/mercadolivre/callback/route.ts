import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard/marketplaces?erro=cancelado', req.url))
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id

  const { data: integracao } = await sb
    .from('sistema_integracoes')
    .select('app_id, app_secret')
    .eq('plataforma', 'mercadolivre')
    .single()

  if (!integracao) return NextResponse.redirect(new URL('/dashboard/marketplaces?erro=sem-credenciais', req.url))

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.vargasnexus.com.br'}/dashboard/marketplaces/callback/mercadolivre`

  // Troca o code pelo access_token
  const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: integracao.app_id,
      client_secret: integracao.app_secret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  const tokenData = await tokenRes.json()

  if (!tokenData.access_token) {
    console.error('ML token error:', tokenData)
    return NextResponse.redirect(new URL('/dashboard/marketplaces?erro=token-invalido', req.url))
  }

  // Busca dados do vendedor
  const userRes = await fetch(`https://api.mercadolibre.com/users/me`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const userData = await userRes.json()

  let nome = userData.nickname ?? `ML ${tokenData.user_id}`
  let markup = '0'
  try {
    const decoded = JSON.parse(Buffer.from(state ?? '', 'base64url').toString())
    if (decoded.nome) nome = decoded.nome
    if (decoded.markup) markup = decoded.markup
  } catch (_) {}

  await sb.from('marketplace_canais').insert({
    empresa_id: empresaId,
    nome,
    plataforma: 'mercadolivre',
    seller_id: String(tokenData.user_id),
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_expira_em: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    markup_canal: parseFloat(markup) || 0,
    sincronizar_estoque: true,
    sincronizar_preco: true,
    ativo: true,
  })

  return NextResponse.redirect(new URL('/dashboard/marketplaces?sucesso=mercadolivre', req.url))
}
