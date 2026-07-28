import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

async function buscarParceriaDoUsuario(sb: any, parceriaId: string, empresaId: string) {
  const { data } = await sb.from('empresa_parcerias').select('id, empresa_id_a, empresa_id_b, status')
    .eq('id', parceriaId).maybeSingle()
  if (!data) return null
  if (data.empresa_id_a !== empresaId && data.empresa_id_b !== empresaId) return null
  return data
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const parceria = await buscarParceriaDoUsuario(sb, id, guarda.empresaId)
  if (!parceria) return NextResponse.json({ ok: false, erro: 'Parceria não encontrada' }, { status: 404 })

  const body = await req.json()
  const status = body?.status === 'ativa' ? 'ativa' : body?.status === 'inativa' ? 'inativa' : null
  if (!status) return NextResponse.json({ ok: false, erro: 'status inválido' }, { status: 400 })

  const { error } = await sb.from('empresa_parcerias').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: status === 'ativa' ? 'parceria_ativada' : 'parceria_desativada', tabela: 'empresa_parcerias',
    valorAnterior: { status: parceria.status }, valorNovo: { status },
  })

  return NextResponse.json({ ok: true })
}
