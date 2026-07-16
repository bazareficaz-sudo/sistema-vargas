import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncPedidos } from '@/lib/shopee/orders'
import type { ShopeeChannel } from '@/lib/shopee/types'

export async function POST(req: Request) {
  const { canalId, maxOrders } = await req.json()
  if (!canalId) return NextResponse.json({ ok: false, erro: 'canalId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .eq('plataforma', 'shopee')
    .single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })
  }

  const canal: ShopeeChannel = {
    id: canalRow.id,
    empresaId: canalRow.empresa_id,
    sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token,
    refreshToken: canalRow.refresh_token,
    tokenExpiraEm: canalRow.token_expira_em,
  }

  try {
    const resultado = await syncPedidos(sb, canal, { maxOrders: typeof maxOrders === 'number' ? maxOrders : undefined })

    const status = resultado.upserted > 0 || resultado.totalFound === 0 ? 'ok' : 'erro'
    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId,
      tipo: 'sync_pedidos',
      status,
      mensagem: `Encontrados: ${resultado.totalFound} · Sincronizados: ${resultado.upserted} · Falhas: ${resultado.failed.length}${resultado.truncated ? ' · Truncado (rodar novamente)' : ''}`,
      detalhes: resultado,
    })

    await sb.from('marketplace_canais').update({ ultima_sincronizacao_pedidos: new Date().toISOString() }).eq('id', canalId)

    return NextResponse.json({
      ok: true,
      totalFound: resultado.totalFound,
      upserted: resultado.upserted,
      failedCount: resultado.failed.length,
      failed: resultado.failed,
      truncated: resultado.truncated,
    })
  } catch (e: any) {
    const erro = e?.message ?? 'Erro ao sincronizar pedidos com a Shopee'
    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId,
      tipo: 'sync_pedidos',
      status: 'erro',
      mensagem: erro,
      detalhes: { error: erro },
    })
    return NextResponse.json({ ok: false, erro }, { status: 400 })
  }
}
