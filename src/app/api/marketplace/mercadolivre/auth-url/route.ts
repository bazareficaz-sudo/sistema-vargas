import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const sb = await createClient()

  const { data: integracao } = await sb
    .from('sistema_integracoes')
    .select('app_id')
    .eq('plataforma', 'mercadolivre')
    .single()

  if (!integracao?.app_id) {
    return NextResponse.json({ error: 'Credenciais do Mercado Livre não configuradas em Configurações → Integrações.' }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const canalNome = searchParams.get('nome') ?? 'nova-loja'
  const markup = searchParams.get('markup') ?? '0'

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/dashboard/marketplaces/callback/mercadolivre`
  const state = Buffer.from(JSON.stringify({ nome: canalNome, markup })).toString('base64url')

  const authUrl =
    `https://auth.mercadolivre.com.br/authorization` +
    `?response_type=code&client_id=${integracao.app_id}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`

  return NextResponse.json({ url: authUrl })
}
