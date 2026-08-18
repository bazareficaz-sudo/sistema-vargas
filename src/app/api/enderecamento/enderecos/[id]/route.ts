import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data, error } = await sb.from('enderecos').select('*').eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, erro: 'Endereço não encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true, endereco: data })
}

type CorpoEditar = {
  descricao?: string | null
  tipo?: string
  status?: string
  exclusivo?: boolean
  capacidadeMaxima?: number | null
  sequenciaPicking?: number | null
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as CorpoEditar
  const { data: atual } = await sb.from('enderecos').select('id').eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!atual) return NextResponse.json({ ok: false, erro: 'Endereço não encontrado.' }, { status: 404 })

  const campos: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.descricao !== undefined) campos.descricao = body.descricao || null
  if (body.tipo !== undefined) campos.tipo = body.tipo
  if (body.status !== undefined) campos.status = body.status
  if (body.exclusivo !== undefined) campos.exclusivo = body.exclusivo
  if (body.capacidadeMaxima !== undefined) campos.capacidade_maxima = body.capacidadeMaxima
  if (body.sequenciaPicking !== undefined) campos.sequencia_picking = body.sequenciaPicking

  const { data: atualizado, error } = await sb.from('enderecos').update(campos).eq('id', id).select().single()
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, endereco: atualizado })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: endereco } = await sb.from('enderecos').select('id').eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!endereco) return NextResponse.json({ ok: false, erro: 'Endereço não encontrado.' }, { status: 404 })

  // Nunca apaga endereço com saldo — o mesmo cuidado usado em todo o resto
  // do sistema (produtos, depósitos): soft-delete, nunca perda de rastro.
  const { data: comSaldo } = await sb.from('produto_enderecos')
    .select('id').eq('endereco_id', id).gt('quantidade', 0).limit(1)
  if (comSaldo && comSaldo.length > 0) {
    return NextResponse.json({ ok: false, erro: 'Este endereço tem estoque — esvazie antes de excluir.' }, { status: 400 })
  }

  const { error } = await sb.from('enderecos').update({ ativo: false, status: 'inativo', updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
