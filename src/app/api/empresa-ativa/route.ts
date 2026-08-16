import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { COOKIE_EMPRESA, empresasDoUsuario } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Troca a empresa em que a sessão está trabalhando.
//
// A validação é aqui, no servidor, e não na tela: o cookie é gravado só
// depois de conferir que o vínculo existe em `usuario_empresas`. Se fosse a
// tela que decidisse, trocar de empresa seria editar um cookie no navegador.
//
// Não altera `profiles.empresa_id` — a empresa do cadastro continua sendo a
// padrão, e é para ela que a sessão volta quando o cookie sai.

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  return NextResponse.json({ ok: true, empresas: await empresasDoUsuario(sb, user.id) })
}

export async function POST(req: Request) {
  const { empresaId } = await req.json() as { empresaId?: string }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const permitidas = await empresasDoUsuario(sb, user.id)
  const alvo = permitidas.find(e => e.id === empresaId)
  if (!alvo) {
    return NextResponse.json({ ok: false, erro: 'Você não tem acesso a essa empresa.' }, { status: 403 })
  }

  const resposta = NextResponse.json({ ok: true, empresa: alvo })
  resposta.cookies.set(COOKIE_EMPRESA, alvo.id, {
    httpOnly: true,       // a tela não precisa ler; quem decide é o servidor
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12, // meio dia: a escolha não deve sobreviver ao turno
  })
  return resposta
}

/** Voltar para a empresa do cadastro. */
export async function DELETE() {
  const resposta = NextResponse.json({ ok: true })
  resposta.cookies.set(COOKIE_EMPRESA, '', { path: '/', maxAge: 0 })
  return resposta
}
