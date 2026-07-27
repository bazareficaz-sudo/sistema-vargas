import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Fora de /saas-admin de propósito — precisa ser chamável tanto por quem
// está com a sessão de suporte ativa (é o usuário-alvo, tecnicamente) quanto
// por um system admin encerrando à distância. RLS de suporte_acessos já
// garante que só a própria sessão ou um system admin consegue dar UPDATE.
export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const body = await req.json()
  const sessionId = String(body?.sessionId ?? '')
  if (!sessionId) return NextResponse.json({ ok: false, erro: 'Sessão não informada' }, { status: 400 })

  const { data, error } = await sb.from('suporte_acessos')
    .update({ status: 'encerrada', encerrado_em: new Date().toISOString() })
    .eq('id', sessionId).eq('status', 'ativa')
    .select('id').maybeSingle()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ ok: false, erro: 'Sessão não encontrada ou já encerrada' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
