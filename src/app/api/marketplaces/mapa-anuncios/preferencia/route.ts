import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao, registrarAuditoria } from '@/lib/auth/permissoes'

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json()
  const produtoId = String(body?.produtoId ?? '')
  const canalId = String(body?.canalId ?? '')
  if (!produtoId || !canalId) return NextResponse.json({ ok: false, erro: 'produtoId/canalId ausente' }, { status: 400 })

  const { data: produto } = await sb.from('produtos').select('id').eq('id', produtoId).eq('empresa_id', guarda.empresaId).single()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })
  const { data: canal } = await sb.from('marketplace_canais').select('id, nome').eq('id', canalId).eq('empresa_id', guarda.empresaId).single()
  if (!canal) return NextResponse.json({ ok: false, erro: 'Canal não encontrado' }, { status: 404 })

  const patch: Record<string, unknown> = {
    empresa_id: guarda.empresaId, produto_id: produtoId, canal_id: canalId,
    atualizado_por: guarda.userId, updated_at: new Date().toISOString(),
  }
  if (body.naoAnunciar !== undefined) patch.nao_anunciar = !!body.naoAnunciar
  if (body.observacao !== undefined) patch.observacao = body.observacao || null

  const { error } = await sb.from('produto_canal_preferencias')
    .upsert(patch, { onConflict: 'produto_id,canal_id' })
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  await registrarAuditoria(sb, {
    empresaId: guarda.empresaId, usuarioId: guarda.userId,
    acao: 'preferencia_canal_atualizada', tabela: 'produto_canal_preferencias',
    valorNovo: { produtoId, canalId: canal.id, canalNome: canal.nome, naoAnunciar: body.naoAnunciar, observacao: body.observacao },
  })

  return NextResponse.json({ ok: true })
}
