import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { provisionarEmpresaEUsuario } from '@/lib/signup/provisionar'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  let next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)

    // Confirmação de e-mail habilitada: o cadastro só fica pendente até aqui —
    // termina de criar empresa/perfil/assinatura se ainda não existir.
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.user_metadata?.pending_signup) {
      await provisionarEmpresaEUsuario(createAdminClient(), user.id, user.user_metadata)
    }

    // Rede de segurança pros convites que já saíram sem o `next` correto:
    // quem ainda está como convite_pendente não tem senha definida, então
    // passa pela tela de senha mesmo que o link mande direto pro dashboard.
    if (user && next === '/dashboard') {
      const { data: perfil } = await supabase.from('profiles').select('status').eq('id', user.id).maybeSingle()
      if (perfil?.status === 'convite_pendente') next = '/auth/definir-senha'
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
