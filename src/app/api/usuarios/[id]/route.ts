import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao, registrarAuditoria, PAPEIS, type Papel } from '@/lib/auth/permissoes'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

const STATUS_VALIDOS = ['ativo', 'inativo', 'bloqueado']

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_usuarios')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Ninguém pode mudar o próprio papel nem se bloquear/inativar por essa
  // tela — evita autoexclusão de acesso por engano.
  if (id === guarda.userId) {
    return NextResponse.json({ ok: false, erro: 'Você não pode alterar seu próprio acesso por aqui' }, { status: 400 })
  }

  const alvo = await perfilDaSessao(sb, id, 'empresa_id, role, status, cargo, telefone, observacoes')
  if (!alvo || alvo.empresa_id !== guarda.empresaId) return NextResponse.json({ ok: false, erro: 'Usuário não encontrado' }, { status: 404 })

  const body = await req.json()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const mudancas: { campo: string; anterior: unknown; novo: unknown }[] = []

  if (body.role !== undefined) {
    if (!PAPEIS.some(p => p.valor === body.role)) return NextResponse.json({ ok: false, erro: 'Papel inválido' }, { status: 400 })
    if (body.role !== alvo.role) mudancas.push({ campo: 'role', anterior: alvo.role, novo: body.role })
    patch.role = body.role as Papel
  }
  if (body.status !== undefined) {
    if (!STATUS_VALIDOS.includes(body.status)) return NextResponse.json({ ok: false, erro: 'Status inválido' }, { status: 400 })
    if (body.status !== alvo.status) mudancas.push({ campo: 'status', anterior: alvo.status, novo: body.status })
    patch.status = body.status
  }
  if (body.cargo !== undefined) patch.cargo = body.cargo || null
  if (body.telefone !== undefined) patch.telefone = body.telefone || null
  if (body.observacoes !== undefined) patch.observacoes = body.observacoes || null
  if (body.dataTerminoAcesso !== undefined) patch.data_termino_acesso = body.dataTerminoAcesso || null

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update(patch).eq('id', id)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  for (const m of mudancas) {
    await registrarAuditoria(sb, {
      empresaId: guarda.empresaId, usuarioId: guarda.userId,
      acao: m.campo === 'role' ? 'mudanca_papel' : 'mudanca_status_usuario',
      tabela: 'profiles', campo: m.campo,
      valorAnterior: { usuarioAlvo: id, valor: m.anterior },
      valorNovo: { usuarioAlvo: id, valor: m.novo },
    })
  }

  return NextResponse.json({ ok: true })
}
