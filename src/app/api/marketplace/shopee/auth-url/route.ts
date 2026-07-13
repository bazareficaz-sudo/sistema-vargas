import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getIntegracaoCredentials } from '@/lib/shopee/client'
import { buildPublicBaseString, signRequest } from '@/lib/shopee/signing'

export async function GET(req: Request) {
  const sb = await createClient()

  let partnerId: number, partnerKey: string
  try {
    ;({ partnerId, partnerKey } = await getIntegracaoCredentials(sb))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const canalNome = searchParams.get('nome') ?? 'nova-loja'
  const markup = searchParams.get('markup') ?? '0'

  const timest = Math.floor(Date.now() / 1000)
  const path = '/api/v2/shop/auth_partner'

  // Assinatura HMAC-SHA256 exigida pela Shopee
  const sign = signRequest(partnerKey, buildPublicBaseString(partnerId, path, timest))

  // Em dev usa sistemavargas.com.br (registrado no Shopee) que redireciona para localhost
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sistemavargas.com.br'
  const redirectUri = `${appUrl}/dashboard/marketplaces/callback/shopee`
  const state = Buffer.from(JSON.stringify({ nome: canalNome, markup })).toString('base64url')

  const authUrl =
    `https://partner.shopeemobile.com/api/v2/shop/auth_partner` +
    `?partner_id=${partnerId}&redirect=${encodeURIComponent(redirectUri)}&sign=${sign}&timestamp=${timest}&state=${state}`

  return NextResponse.json({ url: authUrl })
}
