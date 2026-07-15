import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncCatalogo } from '@/lib/shopee/sync'
import type { ShopeeChannel } from '@/lib/shopee/types'

// Fase 7: sincronização automática — antes disso, o catálogo só sincronizava
// quando alguém clicava em "Sincronizar agora". Esta rota roda periodicamente
// (ver vercel.json) e repete a mesma sincronização para TODOS os canais
// Shopee conectados de TODAS as empresas — por isso usa o cliente
// service-role (não há usuário logado num disparo de cron) e trata cada
// canal isoladamente: a falha de uma loja não deve travar as demais.
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()

  const { data: canais } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('plataforma', 'shopee')
    .not('access_token', 'is', null)

  const resultados: { canalId: string; ok: boolean; upserted?: number; failedCount?: number; erro?: string }[] = []

  for (const canalRow of canais ?? []) {
    const canal: ShopeeChannel = {
      id: canalRow.id,
      empresaId: canalRow.empresa_id,
      sellerId: canalRow.seller_id,
      accessToken: canalRow.access_token,
      refreshToken: canalRow.refresh_token,
      tokenExpiraEm: canalRow.token_expira_em,
    }

    try {
      const resultado = await syncCatalogo(sb, canal)
      const status = resultado.upserted > 0 || resultado.totalFound === 0 ? 'ok' : 'erro'

      await sb.from('marketplace_sync_log').insert({
        canal_id: canal.id,
        tipo: 'produto_sync',
        status,
        mensagem: `[automático] Encontrados: ${resultado.totalFound} · Sincronizados: ${resultado.upserted} · Falhas: ${resultado.failed.length}${resultado.truncated ? ' · Truncado (catálogo maior que o limite por execução)' : ''}`,
        detalhes: resultado,
      })
      await sb.from('marketplace_canais').update({ ultima_sincronizacao: new Date().toISOString() }).eq('id', canal.id)

      resultados.push({ canalId: canal.id, ok: true, upserted: resultado.upserted, failedCount: resultado.failed.length })
    } catch (e: any) {
      const erro = e?.message ?? 'Erro ao sincronizar com a Shopee'
      await sb.from('marketplace_sync_log').insert({
        canal_id: canal.id,
        tipo: 'produto_sync',
        status: 'erro',
        mensagem: `[automático] ${erro}`,
        detalhes: { error: erro },
      })
      resultados.push({ canalId: canal.id, ok: false, erro })
    }
  }

  return NextResponse.json({ ok: true, canaisProcessados: resultados.length, resultados })
}
