import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export async function GET(req: Request) {
  const sb = await createClient()

  // Busca credenciais do sistema
  const { data: integracao } = await sb
    .from('sistema_integracoes')
    .select('partner_id, partner_key')
    .eq('plataforma', 'shopee')
    .single()

  if (!integracao?.partner_id || !integracao?.partner_key) {
    return NextResponse.json({ error: 'Credenciais Shopee não configuradas em Configurações → Integrações.' }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const canalNome = searchParams.get('nome') ?? 'nova-loja'
  const markup = searchParams.get('markup') ?? '0'

  const partnerId = Number(integracao.partner_id)
  const partnerKey = integracao.partner_key
  const timest = Math.floor(Date.now() / 1000)
  const path = '/api/v2/shop/auth_partner'

  // Assinatura HMAC-SHA256 exigida pela Shopee
  const baseStr = `${partnerId}${path}${timest}`
  const sign = crypto.createHmac('sha256', partnerKey).update(baseStr).digest('hex')

  // Em dev usa sistemavargas.com.br (registrado no Shopee) que redireciona para localhost
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sistemavargas.com.br'
  const redirectUri = `${appUrl}/dashboard/marketplaces/callback/shopee`
  const state = Buffer.from(JSON.stringify({ nome: canalNome, markup })).toString('base64url')

  const authUrl =
    `https://partner.shopeemobile.com/api/v2/shop/auth_partner` +
    `?partner_id=${partnerId}&redirect=${encodeURIComponent(redirectUri)}&sign=${sign}&timestamp=${timest}&state=${state}`

  return NextResponse.json({ url: authUrl })
}
