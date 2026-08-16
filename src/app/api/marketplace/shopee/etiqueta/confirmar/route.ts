import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { confirmarEnvio, type ShipOrderEscolha } from '@/lib/shopee/logistics'
import type { ShopeeChannel } from '@/lib/shopee/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const { canalId, pedidoId, escolha } = await req.json() as { canalId: string; pedidoId: string; escolha: ShipOrderEscolha }
  if (!canalId || !pedidoId || !escolha?.modalidade) return NextResponse.json({ ok: false, erro: 'canalId/pedidoId/escolha ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'shopee').single()
  if (!canalRow?.access_token) return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado ou não conectado' }, { status: 404 })

  const { data: pedido } = await sb.from('marketplace_pedidos').select('id').eq('id', pedidoId).eq('empresa_id', empresaId).eq('canal_id', canalId).maybeSingle()
  if (!pedido) return NextResponse.json({ ok: false, erro: 'Pedido não encontrado' }, { status: 404 })

  const canal: ShopeeChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }

  try {
    await confirmarEnvio(sb, canal, pedidoId, escolha)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao confirmar envio' }, { status: 400 })
  }
}
