import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { prepararNfeDoPedido, emitirNfeDoPedido } from '@/lib/fiscal/emitirNfePedido'

// NF-e (modelo 55) de pedido de marketplace.
//   GET  → prévia: situação da venda, CFOP/CST de cada item e o que impede a
//          emissão. Não envia nada.
//   POST → emite.
// A lógica toda está em src/lib/fiscal/emitirNfePedido.ts.

async function sessao() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { erro: NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 }) }
  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return { erro: NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 }) }
  return { sb, user, empresaId }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await sessao()
  if ('erro' in s) return s.erro

  const prep = await prepararNfeDoPedido(s.sb, s.empresaId, id)
  if (!prep.ok) return NextResponse.json({ ok: false, erro: prep.erro }, { status: 400 })
  return NextResponse.json({
    ok: true,
    podeEmitir: prep.montagem.ok,
    erros: prep.montagem.ok ? [] : prep.montagem.erros,
    resumo: prep.montagem.resumo,
    emitente: prep.emitente,
    destinatario: prep.destinatario,
  })
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await sessao()
  if ('erro' in s) return s.erro

  const r = await emitirNfeDoPedido(s.sb, s.empresaId, id, s.user.email)
  return NextResponse.json(r, { status: r.ok || r.jaEmitida ? 200 : 400 })
}
