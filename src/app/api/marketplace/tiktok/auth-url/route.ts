import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Link de autorização de VENDEDOR (não Partner/TAP) — o app está cadastrado
// como ISV no Partner Center, então cada lojista autoriza individualmente
// pelo link abaixo. Domínio "Rest of World" (Brasil não é o mercado US) —
// ver partner.tiktokshop.com/docv2/page/authorization-overview-202407.
const AUTHORIZE_URL = 'https://services.tiktokshop.com/open/authorize'

export async function GET(req: Request) {
  const sb = await createClient()

  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: integracao } = await sb
    .from('sistema_integracoes')
    .select('extra')
    .eq('plataforma', 'tiktok')
    .single()

  const serviceId = integracao?.extra?.service_id
  if (!serviceId) {
    return NextResponse.json(
      { error: 'Credenciais da TikTok Shop não configuradas em Configurações → Integrações.' },
      { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const canalNome = searchParams.get('nome') ?? 'Minha loja TikTok Shop'
  const markup = searchParams.get('markup') ?? '0'

  // O redirect_uri é o que está cadastrado no app no Partner Center
  // (https://www.sistemavargas.com.br/dashboard/marketplaces/callback/tiktok)
  // — não vai como parâmetro aqui, mesmo caso da Nuvemshop.
  const state = Buffer.from(JSON.stringify({ nome: canalNome, markup })).toString('base64url')

  const authUrl = `${AUTHORIZE_URL}?service_id=${serviceId}&state=${state}`

  return NextResponse.json({ url: authUrl })
}
