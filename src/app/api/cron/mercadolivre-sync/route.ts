import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncCatalogo } from '@/lib/mercadolivre/sync'
import type { MLChannel } from '@/lib/mercadolivre/types'

// Catálogo do Mercado Livre nunca teve sincronização automática — só rodava
// quando alguém clicava em "Sincronizar agora", e mesmo assim sempre
// recomeçava do zero (offset 0) e nunca avançava além do teto de itens por
// rodada. Confirmado ao vivo: uma conta real com 5.449 anúncios ficava
// travada nos mesmos ~500 primeiros pra sempre, mesmo clicando várias vezes.
// Esta rota roda periodicamente (ver vercel.json) e processa TODOS os
// canais ML conectados — como o cursor de paginação agora é persistido
// (marketplace_canais.ml_scan_scroll_id, ver sync.ts), cada rodada continua
// de onde a anterior parou até cobrir o catálogo inteiro, depois reinicia
// pra pegar preço/estoque/status atualizados.
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()

  const { data: canais, error: erroCanais } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, seller_id, access_token, refresh_token, token_expira_em, ml_scan_scroll_id')
    .eq('plataforma', 'mercadolivre')
    .not('access_token', 'is', null)

  // Mesmo princípio dos outros crons: nunca tratar erro de consulta como "0
  // canais" em silêncio.
  if (erroCanais) {
    return NextResponse.json({ ok: false, erro: erroCanais.message }, { status: 500 })
  }

  const resultados: { canalId: string; ok: boolean; upserted?: number; failedCount?: number; truncated?: boolean; erro?: string }[] = []

  for (const canalRow of canais ?? []) {
    const canal: MLChannel = {
      id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
      accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
      mlScanScrollId: canalRow.ml_scan_scroll_id,
    }

    try {
      const r = await syncCatalogo(sb, canal)
      const status = r.upserted > 0 || r.totalFound === 0 ? 'ok' : 'erro'
      await sb.from('marketplace_sync_log').insert({
        canal_id: canal.id, tipo: 'produto_sync', status,
        mensagem: `[automático] Encontrados: ${r.totalFound} · Sincronizados: ${r.upserted} · Falhas: ${r.failed.length}${r.truncated ? ' · Catálogo grande — continua na próxima rodada' : ''}`,
        detalhes: r,
      })
      await sb.from('marketplace_canais').update({ ultima_sincronizacao: new Date().toISOString() }).eq('id', canal.id)
      resultados.push({ canalId: canal.id, ok: true, upserted: r.upserted, failedCount: r.failed.length, truncated: r.truncated })
    } catch (e: any) {
      const erro = e?.message ?? 'Erro ao sincronizar catálogo com o Mercado Livre'
      await sb.from('marketplace_sync_log').insert({ canal_id: canal.id, tipo: 'produto_sync', status: 'erro', mensagem: `[automático] ${erro}`, detalhes: { error: erro } })
      resultados.push({ canalId: canal.id, ok: false, erro })
    }
  }

  return NextResponse.json({ ok: true, canaisProcessados: resultados.length, resultados })
}
