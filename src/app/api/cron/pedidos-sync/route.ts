import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncPedidos as syncPedidosShopee } from '@/lib/shopee/orders'
import { syncPedidos as syncPedidosML } from '@/lib/mercadolivre/orders'
import { syncPedidos as syncPedidosNuvemshop } from '@/lib/nuvemshop/orders'
import { montarCanal as montarCanalNuvemshop } from '@/lib/nuvemshop/canal'
import type { ShopeeChannel } from '@/lib/shopee/types'
import type { MLChannel } from '@/lib/mercadolivre/types'

// Cron dedicado a pedidos — roda a cada 5 min (ver vercel.json) pra pegar
// pedido novo e MUDANÇA DE STATUS o mais rápido possível, sem esperar o
// cron diário de catálogo/estoque (/api/cron/shopee-sync). Fica separado
// dele de propósito: catálogo é caro (percorre todo o acervo) e não precisa
// rodar a cada 5 min; pedidos sim.
//
// Busca por período de ÚLTIMA ATUALIZAÇÃO (não de criação) nos dois
// marketplaces — é o que permite pegar status mudando (ex: pagamento
// confirmado) em pedidos criados antes da janela, sem reprocessar tudo.
// Janela de 3 dias é suficiente pra isso sem escanear o histórico inteiro
// a cada rodada; upsert é idempotente, então sobreposição entre rodadas é
// inofensiva.
export const maxDuration = 300

const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000
const MAX_ORDERS_POR_CANAL = 100

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const desde = new Date(Date.now() - LOOKBACK_MS)

  const { data: canais, error: erroCanais } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, sincronizar_estoque, debitar_estoque_vendas')
    .in('plataforma', ['shopee', 'mercadolivre', 'nuvemshop'])
    .not('access_token', 'is', null)

  // Nunca falhar em silêncio: se a consulta der erro (ex: coluna que não
  // existe porque uma migration não foi rodada), `canais` viria `null` e o
  // loop abaixo simplesmente não faria nada — sem log nenhum, parecendo
  // sucesso (200 OK, 0 canais processados). Já aconteceu de verdade e
  // ficou dias sem ninguém perceber. Agora fica registrado e visível.
  if (erroCanais) {
    return NextResponse.json({ ok: false, erro: erroCanais.message }, { status: 500 })
  }

  const resultados: { canalId: string; plataforma: string; ok: boolean; totalFound?: number; upserted?: number; failedCount?: number; erro?: string }[] = []

  for (const canalRow of canais ?? []) {
    try {
      let resultado
      if (canalRow.plataforma === 'shopee') {
        const canal: ShopeeChannel = {
          id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
          accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
          sincronizarEstoque: canalRow.sincronizar_estoque, debitarEstoqueVendas: canalRow.debitar_estoque_vendas,
        }
        resultado = await syncPedidosShopee(sb, canal, { maxOrders: MAX_ORDERS_POR_CANAL, desde })
      } else if (canalRow.plataforma === 'nuvemshop') {
        // A Nuvemshop entrega pedido em tempo real por webhook; este robô é
        // rede de segurança para o caso de a notificação se perder.
        resultado = await syncPedidosNuvemshop(sb, montarCanalNuvemshop(canalRow), {
          maxOrders: MAX_ORDERS_POR_CANAL, desde,
        })
      } else {
        const canal: MLChannel = {
          id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
          accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
          sincronizarEstoque: canalRow.sincronizar_estoque, debitarEstoqueVendas: canalRow.debitar_estoque_vendas,
        }
        resultado = await syncPedidosML(sb, canal, { maxOrders: MAX_ORDERS_POR_CANAL, desde })
      }

      const status = resultado.upserted > 0 || resultado.totalFound === 0 ? 'ok' : 'erro'
      await sb.from('marketplace_sync_log').insert({
        canal_id: canalRow.id, tipo: 'sync_pedidos', status,
        mensagem: `[automático 5min] Encontrados: ${resultado.totalFound} · Sincronizados: ${resultado.upserted} · Falhas: ${resultado.failed.length}`,
        detalhes: resultado,
      })
      await sb.from('marketplace_canais').update({ ultima_sincronizacao_pedidos: new Date().toISOString() }).eq('id', canalRow.id)

      resultados.push({ canalId: canalRow.id, plataforma: canalRow.plataforma, ok: true, totalFound: resultado.totalFound, upserted: resultado.upserted, failedCount: resultado.failed.length })
    } catch (e: any) {
      const erro = e?.message ?? 'Erro ao sincronizar pedidos'
      await sb.from('marketplace_sync_log').insert({ canal_id: canalRow.id, tipo: 'sync_pedidos', status: 'erro', mensagem: `[automático 5min] ${erro}`, detalhes: { error: erro } })
      resultados.push({ canalId: canalRow.id, plataforma: canalRow.plataforma, ok: false, erro })
    }
  }

  return NextResponse.json({ ok: true, canaisProcessados: resultados.length, resultados })
}
