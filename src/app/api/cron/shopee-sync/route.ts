import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncCatalogo } from '@/lib/shopee/sync'
import { syncPedidos } from '@/lib/shopee/orders'
import { sincronizarEstoqueAutomatico } from '@/lib/shopee/autoStockSync'
import type { ShopeeChannel } from '@/lib/shopee/types'

// Fase 7 (catálogo) + Central de Pedidos Fase 2 (pedidos): esta rota roda
// periodicamente (ver vercel.json — schedule NÃO deve ser alterado aqui,
// um schedule inválido já bloqueou silenciosamente todos os deploys do
// projeto uma vez) e repete a sincronização de catálogo E de pedidos para
// TODOS os canais Shopee conectados. Usa o cliente service-role (não há
// usuário logado num disparo de cron) e trata cada canal isoladamente — a
// falha de uma loja não deve travar as demais. Catálogo e pedidos do MESMO
// canal rodam em paralelo (Promise.allSettled) para não dobrar o tempo total
// à medida que a base cresce, dentro do orçamento de maxDuration.
export const maxDuration = 300

function devidoSincronizarPedidos(canalRow: any): boolean {
  if (!canalRow.ultima_sincronizacao_pedidos) return true
  const intervaloMs = (canalRow.intervalo_sincronizacao_pedidos_min ?? 1440) * 60 * 1000
  return Date.now() - new Date(canalRow.ultima_sincronizacao_pedidos).getTime() >= intervaloMs
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()

  const { data: canais } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, ultima_sincronizacao_pedidos, intervalo_sincronizacao_pedidos_min, sincronizar_estoque, debitar_estoque_vendas, atualizar_estoque_canal, aplicar_regra_produto')
    .eq('plataforma', 'shopee')
    .not('access_token', 'is', null)

  const resultados: {
    canalId: string
    catalogo: { ok: boolean; upserted?: number; failedCount?: number; erro?: string }
    pedidos: { ok: boolean; skipped?: boolean; upserted?: number; failedCount?: number; erro?: string }
    estoqueAuto: { ok: boolean; processados?: number; enviados?: number; falhas?: number; pausados?: number; erro?: string }
  }[] = []

  for (const canalRow of canais ?? []) {
    const canal: ShopeeChannel = {
      id: canalRow.id,
      empresaId: canalRow.empresa_id,
      sellerId: canalRow.seller_id,
      accessToken: canalRow.access_token,
      refreshToken: canalRow.refresh_token,
      tokenExpiraEm: canalRow.token_expira_em,
      sincronizarEstoque: canalRow.sincronizar_estoque,
      debitarEstoqueVendas: canalRow.debitar_estoque_vendas,
    }

    const sincronizarPedidosAgora = devidoSincronizarPedidos(canalRow)

    const [catalogoSettled, pedidosSettled] = await Promise.allSettled([
      syncCatalogo(sb, canal),
      sincronizarPedidosAgora ? syncPedidos(sb, canal) : Promise.resolve(null),
    ])

    let catalogo: { ok: boolean; upserted?: number; failedCount?: number; erro?: string }
    if (catalogoSettled.status === 'fulfilled') {
      const r = catalogoSettled.value
      const status = r.upserted > 0 || r.totalFound === 0 ? 'ok' : 'erro'
      await sb.from('marketplace_sync_log').insert({
        canal_id: canal.id, tipo: 'produto_sync', status,
        mensagem: `[automático] Encontrados: ${r.totalFound} · Sincronizados: ${r.upserted} · Falhas: ${r.failed.length}${r.truncated ? ' · Truncado' : ''}`,
        detalhes: r,
      })
      await sb.from('marketplace_canais').update({ ultima_sincronizacao: new Date().toISOString() }).eq('id', canal.id)
      catalogo = { ok: true, upserted: r.upserted, failedCount: r.failed.length }
    } else {
      const erro = catalogoSettled.reason?.message ?? 'Erro ao sincronizar catálogo com a Shopee'
      await sb.from('marketplace_sync_log').insert({ canal_id: canal.id, tipo: 'produto_sync', status: 'erro', mensagem: `[automático] ${erro}`, detalhes: { error: erro } })
      catalogo = { ok: false, erro }
    }

    let pedidos: { ok: boolean; skipped?: boolean; upserted?: number; failedCount?: number; erro?: string }
    if (!sincronizarPedidosAgora) {
      pedidos = { ok: true, skipped: true }
    } else if (pedidosSettled.status === 'fulfilled' && pedidosSettled.value) {
      const r = pedidosSettled.value
      const status = r.upserted > 0 || r.totalFound === 0 ? 'ok' : 'erro'
      await sb.from('marketplace_sync_log').insert({
        canal_id: canal.id, tipo: 'sync_pedidos', status,
        mensagem: `[automático] Encontrados: ${r.totalFound} · Sincronizados: ${r.upserted} · Falhas: ${r.failed.length}${r.truncated ? ' · Truncado' : ''}`,
        detalhes: r,
      })
      await sb.from('marketplace_canais').update({ ultima_sincronizacao_pedidos: new Date().toISOString() }).eq('id', canal.id)
      pedidos = { ok: true, upserted: r.upserted, failedCount: r.failed.length }
    } else {
      const erro = pedidosSettled.status === 'rejected' ? (pedidosSettled.reason?.message ?? 'Erro ao sincronizar pedidos com a Shopee') : 'Erro desconhecido'
      await sb.from('marketplace_sync_log').insert({ canal_id: canal.id, tipo: 'sync_pedidos', status: 'erro', mensagem: `[automático] ${erro}`, detalhes: { error: erro } })
      pedidos = { ok: false, erro }
    }

    let estoqueAuto: { ok: boolean; processados?: number; enviados?: number; falhas?: number; pausados?: number; erro?: string } = { ok: true }
    if (canalRow.sincronizar_estoque && canalRow.atualizar_estoque_canal) {
      try {
        const r = await sincronizarEstoqueAutomatico(sb, canal, { aplicarRegraProduto: !!canalRow.aplicar_regra_produto })
        await sb.from('marketplace_sync_log').insert({
          canal_id: canal.id, tipo: 'auto_estoque', status: r.falhas === 0 ? 'ok' : 'erro',
          mensagem: `[automático] Processados: ${r.processados} · Enviados: ${r.enviados} · Falhas: ${r.falhas} · Pausados: ${r.pausados}`,
          detalhes: r,
        })
        estoqueAuto = { ok: true, ...r }
      } catch (e: any) {
        const erro = e?.message ?? 'Erro ao sincronizar estoque automaticamente'
        await sb.from('marketplace_sync_log').insert({ canal_id: canal.id, tipo: 'auto_estoque', status: 'erro', mensagem: `[automático] ${erro}`, detalhes: { error: erro } })
        estoqueAuto = { ok: false, erro }
      }
    }

    resultados.push({ canalId: canal.id, catalogo, pedidos, estoqueAuto })
  }

  return NextResponse.json({ ok: true, canaisProcessados: resultados.length, resultados })
}
