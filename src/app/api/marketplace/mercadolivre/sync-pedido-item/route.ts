import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncSinglePedido } from '@/lib/mercadolivre/orders'
import type { MLChannel } from '@/lib/mercadolivre/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const { canalId, orderId } = await req.json()
  if (!canalId || !orderId) return NextResponse.json({ ok: false, erro: 'canalId/orderId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .eq('plataforma', 'mercadolivre')
    .single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Mercado Livre não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })
  }

  const canal: MLChannel = {
    id: canalRow.id,
    empresaId: canalRow.empresa_id,
    sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token,
    refreshToken: canalRow.refresh_token,
    tokenExpiraEm: canalRow.token_expira_em,
  }

  const resultado = await syncSinglePedido(sb, canal, String(orderId))

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: 'sync_pedido_item',
    status: resultado.ok ? 'ok' : 'erro',
    mensagem: resultado.ok ? `Pedido ${orderId} sincronizado` : resultado.error,
    detalhes: resultado,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.error }, { status: 400 })

  const { data: pedido } = await sb
    .from('marketplace_pedidos')
    .select('*, marketplace_pedido_itens(*), marketplace_pedido_pacotes(*)')
    .eq('id', resultado.pedidoId)
    .single()

  return NextResponse.json({ ok: true, pedido })
}
