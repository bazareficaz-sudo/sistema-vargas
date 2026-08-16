import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao, registrarAuditoria, PAPEIS, type Papel } from '@/lib/auth/permissoes'
import { verificarLimite } from '@/lib/plans/access'
import { urlDoApp } from '@/lib/appUrl'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_usuarios')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json()
  const email = String(body?.email ?? '').trim().toLowerCase()
  const nome = String(body?.nome ?? '').trim()
  const role = body?.role as Papel
  const telefone = body?.telefone ? String(body.telefone).trim() : null
  const cargo = body?.cargo ? String(body.cargo).trim() : null
  const dataTerminoAcesso = body?.dataTerminoAcesso || null

  if (!email || !email.includes('@')) return NextResponse.json({ ok: false, erro: 'E-mail inválido' }, { status: 400 })
  if (!nome) return NextResponse.json({ ok: false, erro: 'Nome é obrigatório' }, { status: 400 })
  if (!PAPEIS.some(p => p.valor === role)) return NextResponse.json({ ok: false, erro: 'Papel inválido' }, { status: 400 })

  const admin = createAdminClient()

  const { count: totalUsuarios } = await sb.from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', guarda.empresaId)
    .neq('status', 'inativo')
  const limite = await verificarLimite('max_usuarios', totalUsuarios ?? 0, guarda.empresaId, guarda.userId)
  if (!limite.permitido) {
    return NextResponse.json({ ok: false, erro: `Seu plano permite até ${limite.limite} usuário(s). Inative alguém ou fale com a gente pra ampliar.` }, { status: 400 })
  }

  const quemConvidou = await perfilDaSessao(sb, guarda.userId, 'empresa_id, tenant_id, grupo_id')

  const { data: convite, error: erroConvite } = await admin.auth.admin.inviteUserByEmail(email, {
    // O Supabase cria a conta do convidado SEM senha. Sem mandar ele pra
    // tela de definir senha, ele entrava só naquela sessão e nunca mais
    // conseguia logar de novo.
    redirectTo: urlDoApp('/auth/callback?next=/auth/definir-senha'),
  })
  if (erroConvite || !convite?.user) {
    return NextResponse.json({ ok: false, erro: erroConvite?.message ?? 'Erro ao enviar convite' }, { status: 400 })
  }

  const { error: erroProfile } = await admin.from('profiles').insert({
    id: convite.user.id,
    empresa_id: quemConvidou?.empresa_id ?? guarda.empresaId,
    tenant_id: quemConvidou?.tenant_id ?? null,
    grupo_id: quemConvidou?.grupo_id ?? null,
    role,
    nome,
    telefone,
    cargo,
    status: 'convite_pendente',
    data_termino_acesso: dataTerminoAcesso,
  })
  if (erroProfile) {
    return NextResponse.json({ ok: false, erro: 'Convite enviado, mas houve erro ao registrar o perfil: ' + erroProfile.message }, { status: 400 })
  }

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'convite_usuario', tabela: 'profiles',
    valorNovo: { email, nome, role },
  })

  return NextResponse.json({ ok: true })
}
