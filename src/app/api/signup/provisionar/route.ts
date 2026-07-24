import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { provisionarEmpresaEUsuario } from '@/lib/signup/provisionar'

export async function POST() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Não autenticado.' }, { status: 401 })

  const resultado = await provisionarEmpresaEUsuario(createAdminClient(), user.id, user.user_metadata)
  if (!resultado.ok) return NextResponse.json(resultado, { status: 400 })
  return NextResponse.json(resultado)
}
