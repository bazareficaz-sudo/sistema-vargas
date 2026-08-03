import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const sb = await createClient()

  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: integracao } = await sb
    .from('sistema_integracoes')
    .select('app_id')
    .eq('plataforma', 'nuvemshop')
    .single()

  if (!integracao?.app_id) {
    return NextResponse.json(
      { error: 'Credenciais da Nuvemshop não configuradas em Configurações → Integrações.' },
      { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const canalNome = searchParams.get('nome') ?? 'Minha loja Nuvemshop'
  const markup = searchParams.get('markup') ?? '0'

  // Diferente de Shopee e Mercado Livre, a Nuvemshop NÃO recebe redirect_uri
  // na URL de autorização: o endereço de retorno é o que está cadastrado no
  // aplicativo, no painel de parceiro. Mandar aqui não tem efeito — se o
  // retorno estiver errado, o ajuste é no cadastro do app, não no código.
  const state = Buffer.from(JSON.stringify({ nome: canalNome, markup })).toString('base64url')

  const authUrl = `https://www.nuvemshop.com.br/apps/${integracao.app_id}/authorize?state=${state}`

  return NextResponse.json({ url: authUrl })
}
