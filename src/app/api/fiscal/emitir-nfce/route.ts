import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { emitirNfceParaVenda } from '@/lib/fiscal/emitirParaVenda'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const { vendaId } = await req.json()
  if (!vendaId) return NextResponse.json({ ok: false, erro: 'vendaId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const resultado = await emitirNfceParaVenda(sb, empresaId, vendaId, user.email)
  return NextResponse.json(resultado, { status: resultado.ok || resultado.jaEmitida ? 200 : 400 })
}
