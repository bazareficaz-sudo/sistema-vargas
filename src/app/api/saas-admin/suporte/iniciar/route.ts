import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirSystemAdmin } from '@/lib/auth/saasAdmin'
import { registrarAuditoria } from '@/lib/auth/permissoes'

const DURACAO_HORAS = 2

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirSystemAdmin(sb)
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json()
  const empresaId = String(body?.empresaId ?? '')
  const motivo = String(body?.motivo ?? '').trim()

  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não informada' }, { status: 400 })
  if (motivo.length < 10) return NextResponse.json({ ok: false, erro: 'Descreva o motivo do acesso (mínimo 10 caracteres)' }, { status: 400 })

  const admin = createAdminClient()

  const { data: empresa } = await admin.from('empresas').select('nome, nome_fantasia').eq('id', empresaId).single()
  if (!empresa) return NextResponse.json({ ok: false, erro: 'Empresa não encontrada' }, { status: 404 })

  const { data: alvo } = await admin.from('profiles')
    .select('id').eq('empresa_id', empresaId).eq('role', 'admin').eq('status', 'ativo')
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!alvo) return NextResponse.json({ ok: false, erro: 'Nenhum administrador ativo nesta empresa para representar' }, { status: 400 })

  const { data: authUser } = await admin.auth.admin.getUserById(alvo.id)
  const email = authUser?.user?.email
  if (!email) return NextResponse.json({ ok: false, erro: 'E-mail do usuário-alvo não encontrado' }, { status: 400 })

  const expiraEm = new Date(Date.now() + DURACAO_HORAS * 60 * 60 * 1000).toISOString()

  const { error: erroInsert } = await admin.from('suporte_acessos').insert({
    admin_id: guarda.adminId, empresa_id: empresaId, usuario_alvo_id: alvo.id,
    motivo, expira_em: expiraEm,
  })
  if (erroInsert) return NextResponse.json({ ok: false, erro: erroInsert.message }, { status: 400 })

  const { data: link, error: erroLink } = await admin.auth.admin.generateLink({
    type: 'magiclink', email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.vargasnexus.com.br'}/auth/callback` },
  })
  if (erroLink || !link?.properties?.action_link) {
    return NextResponse.json({ ok: false, erro: erroLink?.message ?? 'Erro ao gerar link de acesso' }, { status: 400 })
  }

  await registrarAuditoria(sb, {
    empresaId, usuarioId: guarda.adminId,
    acao: 'acesso_suporte_iniciado', tabela: 'suporte_acessos',
    valorNovo: { motivo, usuarioAlvo: alvo.id, empresa: empresa.nome_fantasia ?? empresa.nome },
  })

  return NextResponse.json({ ok: true, actionLink: link.properties.action_link, expiraEm })
}
