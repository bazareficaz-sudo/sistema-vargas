import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_usuarios')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: alvo } = await sb.from('profiles')
    .select('empresa_id, status').eq('id', id).single()
  if (!alvo || alvo.empresa_id !== guarda.empresaId) return NextResponse.json({ ok: false, erro: 'Usuário não encontrado' }, { status: 404 })
  if (alvo.status !== 'convite_pendente') return NextResponse.json({ ok: false, erro: 'Este usuário já aceitou o convite' }, { status: 400 })

  const admin = createAdminClient()
  const { data: authUser } = await admin.auth.admin.getUserById(id)
  const email = authUser?.user?.email
  if (!email) return NextResponse.json({ ok: false, erro: 'E-mail do usuário não encontrado' }, { status: 400 })

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    // O Supabase cria a conta do convidado SEM senha. Sem mandar ele pra
    // tela de definir senha, ele entrava só naquela sessão e nunca mais
    // conseguia logar de novo.
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.vargasnexus.com.br'}/auth/callback?next=/auth/definir-senha`,
  })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'reenvio_convite', tabela: 'profiles', valorNovo: { usuarioAlvo: id },
  })

  return NextResponse.json({ ok: true })
}
