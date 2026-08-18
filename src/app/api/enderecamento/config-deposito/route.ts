import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const depositoId = searchParams.get('depositoId')
  if (!depositoId) return NextResponse.json({ ok: false, erro: 'Escolha o depósito.' }, { status: 400 })

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const { data: config } = await sb.from('deposito_enderecamento_config').select('*').eq('deposito_id', depositoId).maybeSingle()

  return NextResponse.json({
    ok: true,
    config: config ?? {
      deposito_id: depositoId, modo: 'desativado', separador: '-',
      niveis: ['zona', 'corredor', 'estante', 'nivel', 'posicao'], padding_por_nivel: {},
    },
  })
}

type Corpo = {
  depositoId?: string
  niveis?: string[]
  separador?: string
  paddingPorNivel?: Record<string, number>
  modo?: 'desativado' | 'opcional' | 'obrigatorio'
}

export async function PATCH(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const { depositoId } = body
  if (!depositoId) return NextResponse.json({ ok: false, erro: 'Escolha o depósito.' }, { status: 400 })

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const campos: Record<string, unknown> = { empresa_id: guarda.empresaId, deposito_id: depositoId, updated_at: new Date().toISOString() }
  if (body.niveis) campos.niveis = body.niveis
  if (body.separador !== undefined) campos.separador = body.separador
  if (body.paddingPorNivel) campos.padding_por_nivel = body.paddingPorNivel
  if (body.modo) campos.modo = body.modo

  const { data: existente } = await sb.from('deposito_enderecamento_config').select('id').eq('deposito_id', depositoId).maybeSingle()
  const { data: salvo, error } = existente
    ? await sb.from('deposito_enderecamento_config').update(campos).eq('id', existente.id).select().single()
    : await sb.from('deposito_enderecamento_config').insert(campos).select().single()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, config: salvo })
}
