import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: vinculo } = await sb.from('produto_vinculos')
    .select('id, parceria_id, empresa_parcerias!inner(empresa_id_a, empresa_id_b)')
    .eq('id', id).maybeSingle()
  if (!vinculo) return NextResponse.json({ ok: false, erro: 'Vínculo não encontrado' }, { status: 404 })

  const parceria = (vinculo as any).empresa_parcerias
  if (parceria.empresa_id_a !== guarda.empresaId && parceria.empresa_id_b !== guarda.empresaId) {
    return NextResponse.json({ ok: false, erro: 'Vínculo não encontrado' }, { status: 404 })
  }

  const { error } = await sb.from('produto_vinculos').delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'produto_desvinculado', tabela: 'produto_vinculos', valorAnterior: { id },
  })

  return NextResponse.json({ ok: true })
}
