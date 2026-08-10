import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sincronizarEstoqueAutomatico } from '@/lib/shopee/autoStockSync'
import type { ShopeeChannel } from '@/lib/shopee/types'

// Envio automático de estoque para a Shopee (sistema → canal).
//
// ── O que esta rota DEIXOU de fazer ─────────────────────────
//
// Antes ela também importava o catálogo e os pedidos da Shopee. As duas
// coisas saíram daqui:
//
//   • catálogo  → /api/cron/anuncios-sync (Fase 1), que cobre TODAS as
//     plataformas, é retomável e sabe continuar de onde parou;
//   • pedidos   → /api/cron/pedidos-sync (Fase 2), que já roda de 10 em 10
//     minutos e cobre Shopee, Mercado Livre e Nuvemshop.
//
// Fazendo as três coisas ao mesmo tempo, esta rota estourava os 300s da
// Vercel todo dia — e morria antes de gravar o log, então a falha não
// aparecia em lugar nenhum. Os dois canais Shopee ficaram 2 e 3 dias sem
// atualizar sem ninguém ver.
//
// ── O que ainda faz, e por quanto tempo ─────────────────────
//
// Sobrou o envio automático de estoque. Ele é provisório: a Fase 3 (fila de
// atualização) substitui isto por um envio disparado por movimentação real,
// para todos os canais, e não por varredura periódica de um só. Quando a fila
// entrar no ar, esta rota sai.

export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()

  const { data: canais, error: erroCanais } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, seller_id, access_token, refresh_token, token_expira_em, sincronizar_estoque, debitar_estoque_vendas, atualizar_estoque_canal, aplicar_regra_produto')
    .eq('plataforma', 'shopee')
    .not('access_token', 'is', null)

  // Nunca tratar erro de consulta como "0 canais" em silêncio — já causou
  // dias de sincronização parada sem nenhum log.
  if (erroCanais) {
    return NextResponse.json({ ok: false, erro: erroCanais.message }, { status: 500 })
  }

  const resultados: { canalId: string; ok: boolean; processados?: number; enviados?: number; falhas?: number; pausados?: number; pulado?: boolean; erro?: string }[] = []

  for (const canalRow of canais ?? []) {
    if (!canalRow.sincronizar_estoque || !canalRow.atualizar_estoque_canal) {
      resultados.push({ canalId: canalRow.id, ok: true, pulado: true })
      continue
    }

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

    try {
      const r = await sincronizarEstoqueAutomatico(sb, canal, { aplicarRegraProduto: !!canalRow.aplicar_regra_produto })
      await sb.from('marketplace_sync_log').insert({
        canal_id: canal.id, tipo: 'auto_estoque', status: r.falhas === 0 ? 'ok' : 'erro',
        mensagem: `[automático] Processados: ${r.processados} · Enviados: ${r.enviados} · Falhas: ${r.falhas} · Pausados: ${r.pausados}`,
        detalhes: r,
      })
      resultados.push({ canalId: canal.id, ok: true, ...r })
    } catch (e: any) {
      const erro = e?.message ?? 'Erro ao sincronizar estoque automaticamente'
      await sb.from('marketplace_sync_log').insert({ canal_id: canal.id, tipo: 'auto_estoque', status: 'erro', mensagem: `[automático] ${erro}`, detalhes: { error: erro } })
      resultados.push({ canalId: canal.id, ok: false, erro })
    }
  }

  return NextResponse.json({ ok: true, canaisProcessados: resultados.length, resultados })
}
