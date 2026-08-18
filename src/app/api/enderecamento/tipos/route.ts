import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data, error } = await sb.from('endereco_tipos').select('*').eq('empresa_id', guarda.empresaId).eq('ativo', true).order('ordem')
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tipos: data ?? [] })
}

type Corpo = { codigo?: string; nome?: string; cor?: string }

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const codigo = (body.codigo || '').trim().toUpperCase().replace(/\s+/g, '_')
  if (!codigo || !body.nome) return NextResponse.json({ ok: false, erro: 'Código e nome são obrigatórios.' }, { status: 400 })

  const { data: novo, error } = await sb.from('endereco_tipos').insert({
    empresa_id: guarda.empresaId, codigo, nome: body.nome, cor: body.cor || null, sistema: false,
  }).select().single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ ok: false, erro: 'Já existe um tipo com este código.' }, { status: 409 })
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, tipo: novo })
}

export async function PATCH(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as { id?: string; ativo?: boolean; nome?: string; cor?: string }
  if (!body.id) return NextResponse.json({ ok: false, erro: 'Informe o id.' }, { status: 400 })

  const { data: atual } = await sb.from('endereco_tipos').select('id, sistema').eq('id', body.id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!atual) return NextResponse.json({ ok: false, erro: 'Tipo não encontrado.' }, { status: 404 })
  if (atual.sistema && body.ativo === false) {
    return NextResponse.json({ ok: false, erro: 'Tipos padrão do sistema não podem ser desativados.' }, { status: 400 })
  }

  const campos: Record<string, unknown> = {}
  if (body.ativo !== undefined) campos.ativo = body.ativo
  if (body.nome !== undefined) campos.nome = body.nome
  if (body.cor !== undefined) campos.cor = body.cor

  const { data: atualizado, error } = await sb.from('endereco_tipos').update(campos).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tipo: atualizado })
}
