import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recalcularEtapaPedido } from '@/lib/shopee/orders'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Recalcula a etapa_interna de um pedido — chamada depois de um mapeamento
// manual de item, já que a etapa só é atualizada automaticamente durante a
// sincronização (ver comentário em orders.ts).
export async function POST(req: Request) {
  const { pedidoId } = await req.json()
  if (!pedidoId) return NextResponse.json({ ok: false, erro: 'pedidoId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: pedido } = await sb.from('marketplace_pedidos').select('id').eq('id', pedidoId).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido) return NextResponse.json({ ok: false, erro: 'Pedido não encontrado' }, { status: 404 })

  const etapa = await recalcularEtapaPedido(sb, pedidoId)
  return NextResponse.json({ ok: true, etapa })
}
