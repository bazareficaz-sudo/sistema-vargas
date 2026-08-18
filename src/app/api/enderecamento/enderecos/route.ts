import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { montarCodigoEndereco } from '@/lib/enderecamento/estoque'

export const dynamic = 'force-dynamic'

// Listagem/filtro e criação de endereços. RLS desligada em `enderecos`
// (mesmo padrão de produto_estoque/depositos) — esta rota é a fronteira
// real de segurança, reconferindo empresa_id em toda consulta.

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { searchParams } = new URL(req.url)
  const depositoId = searchParams.get('depositoId')
  const tipo = searchParams.get('tipo')
  const status = searchParams.get('status')
  const busca = searchParams.get('busca')

  let q = sb.from('enderecos').select('*').eq('empresa_id', guarda.empresaId).order('codigo_legivel')
  if (depositoId) q = q.eq('deposito_id', depositoId)
  if (tipo) q = q.eq('tipo', tipo)
  if (status) q = q.eq('status', status)
  if (busca) q = q.or(`codigo_legivel.ilike.%${busca}%,codigo_interno.ilike.%${busca}%,descricao.ilike.%${busca}%`)

  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, enderecos: data ?? [] })
}

type CorpoCriar = {
  depositoId?: string
  codigoInterno?: string
  descricao?: string | null
  zona?: string | null; corredor?: string | null; estante?: string | null
  modulo?: string | null; nivel?: string | null; posicao?: string | null
  tipo?: string
  exclusivo?: boolean
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as CorpoCriar
  const { depositoId } = body
  if (!depositoId) return NextResponse.json({ ok: false, erro: 'Escolha o depósito.' }, { status: 400 })

  const { data: deposito } = await sb.from('depositos')
    .select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const { data: config } = await sb.from('deposito_enderecamento_config')
    .select('niveis, separador, padding_por_nivel').eq('deposito_id', depositoId).maybeSingle()
  const niveis = (config?.niveis as string[] | undefined) ?? ['zona', 'corredor', 'estante', 'nivel', 'posicao']
  const separador = config?.separador ?? '-'
  const padding = (config?.padding_por_nivel as Record<string, number> | undefined) ?? {}

  const valoresNivel = {
    zona: body.zona || undefined, corredor: body.corredor || undefined, estante: body.estante || undefined,
    modulo: body.modulo || undefined, nivel: body.nivel || undefined, posicao: body.posicao || undefined,
  }
  const codigoLegivel = montarCodigoEndereco(niveis, valoresNivel, separador, padding)
  if (!codigoLegivel) return NextResponse.json({ ok: false, erro: 'Preencha ao menos um nível de localização.' }, { status: 400 })

  const codigoInterno = body.codigoInterno || codigoLegivel

  const { data: existente } = await sb.from('enderecos')
    .select('id').eq('empresa_id', guarda.empresaId).eq('deposito_id', depositoId).eq('codigo_interno', codigoInterno).maybeSingle()
  if (existente) return NextResponse.json({ ok: false, erro: 'Já existe um endereço com este código neste depósito.' }, { status: 409 })

  const { data: novo, error } = await sb.from('enderecos').insert({
    empresa_id: guarda.empresaId, deposito_id: depositoId,
    codigo_interno: codigoInterno, codigo_legivel: codigoLegivel, descricao: body.descricao || null,
    zona: body.zona || null, corredor: body.corredor || null, estante: body.estante || null,
    modulo: body.modulo || null, nivel: body.nivel || null, posicao: body.posicao || null,
    tipo: body.tipo || 'ARMAZENAGEM', exclusivo: body.exclusivo ?? false,
    qr_code_valor: codigoInterno, codigo_barras_valor: codigoInterno,
    criado_por: guarda.userId,
  }).select().single()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, endereco: novo })
}
