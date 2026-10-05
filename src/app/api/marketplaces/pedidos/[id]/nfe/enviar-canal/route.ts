import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { enviarNfeAoMarketplace } from '@/lib/fiscal/enviarNfeAoMarketplace'

// Reenvia ao marketplace a NF-e já autorizada do pedido. O envio normal
// acontece sozinho logo após a autorização (emitirNfeDoPedido); isto é para
// quando ele falhou — canal fora do ar, token vencido.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })
  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const r = await enviarNfeAoMarketplace(sb, empresaId, id)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
