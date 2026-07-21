import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncPedidos } from '@/lib/mercadolivre/orders'
import type { MLChannel } from '@/lib/mercadolivre/types'

// Mesmo motivo do maxDuration estendido na rota equivalente da Shopee: cada
// pedido processado gera vários round-trips de banco.
export const maxDuration = 300

export async function POST(req: Request) {
  const { canalId, maxOrders } = await req.json()
  if (!canalId) return NextResponse.json({ ok: false, erro: 'canalId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow, error: erroCanal } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, sincronizar_estoque, debitar_estoque_vendas')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .eq('plataforma', 'mercadolivre')
    .single()

  // Antes essa checagem só olhava `!canalRow`, o que faz uma consulta que
  // falhou (ex: coluna inexistente por migration não rodada) aparecer pro
  // usuário como "canal não encontrado" — mensagem enganosa que já mascarou
  // esse bug real por dias. Reportar o erro de verdade quando ele existir.
  if (erroCanal) return NextResponse.json({ ok: false, erro: erroCanal.message }, { status: 500 })
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
    sincronizarEstoque: canalRow.sincronizar_estoque,
    debitarEstoqueVendas: canalRow.debitar_estoque_vendas,
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
    const erro = e?.message ?? 'Erro ao sincronizar pedidos com o Mercado Livre'
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
