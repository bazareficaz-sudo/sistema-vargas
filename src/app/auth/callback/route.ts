import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { provisionarEmpresaEUsuario } from '@/lib/signup/provisionar'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)

    // Confirmação de e-mail habilitada: o cadastro só fica pendente até aqui —
    // termina de criar empresa/perfil/assinatura se ainda não existir.
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.user_metadata?.pending_signup) {
      await provisionarEmpresaEUsuario(createAdminClient(), user.id, user.user_metadata)
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
