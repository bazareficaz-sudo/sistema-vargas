import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncCatalogo as syncCatalogoShopee } from '@/lib/shopee/sync'
import { syncCatalogo as syncCatalogoML } from '@/lib/mercadolivre/sync'
import type { ShopeeChannel } from '@/lib/shopee/types'
import type { MLChannel } from '@/lib/mercadolivre/types'

// Retrato diário dos anúncios: canal → sistema, uma vez por dia, TODOS os
// canais conectados, de todas as plataformas.
//
// É deliberadamente SÓ LEITURA. Traz o que mudou lá fora — preço, estoque do
// canal, anúncio novo, anúncio encerrado ou pausado — e atualiza a situação
// aqui dentro. Não envia nada, não corrige nada, não republica nada.
//
// Isso é uma garantia estrutural, não só uma intenção: `syncCatalogo` (das
// duas plataformas) importa apenas `shopeeGet`/`mlGet`. Nenhuma função de
// escrita da API entra nesse caminho, então não há como este cron alterar um
// anúncio nem por engano.
//
// Por que existe, tendo os outros crons: o da Shopee roda 1×/dia mas só olha
// Shopee; o do Mercado Livre roda de 30 em 30 min e só olha ML. Nenhum dos
// dois dá um retrato do sistema inteiro — e canal de plataforma nova entraria
// sem cobertura nenhuma. Aqui a regra é a lista de canais conectados, não a
// plataforma.

export const maxDuration = 300

type Resultado = {
  canalId: string
  canalNome: string
  plataforma: string
  ok: boolean
  encontrados?: number
  atualizados?: number
  falhas?: number
  truncado?: boolean
  erro?: string
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()

  // Sem filtro de plataforma de propósito: o critério é "canal conectado".
  const { data: canais, error: erroCanais } = await sb
    .from('marketplace_canais')
    .select('id, nome, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, sincronizar_estoque, debitar_estoque_vendas, ml_scan_scroll_id')
    .not('access_token', 'is', null)
    .order('nome')

  // Nunca tratar erro de consulta como "0 canais" em silêncio — já custou
  // dias de sincronização parada sem nenhum log nesta base.
  if (erroCanais) {
    return NextResponse.json({ ok: false, erro: erroCanais.message }, { status: 500 })
  }

  const resultados: Resultado[] = []

  for (const c of canais ?? []) {
    const base = { canalId: c.id, canalNome: c.nome, plataforma: c.plataforma }
    try {
      let r: { totalFound: number; upserted: number; failed: any[]; truncated?: boolean }

      if (c.plataforma === 'shopee') {
        const canal: ShopeeChannel = {
          id: c.id, empresaId: c.empresa_id, sellerId: c.seller_id,
          accessToken: c.access_token, refreshToken: c.refresh_token, tokenExpiraEm: c.token_expira_em,
          sincronizarEstoque: c.sincronizar_estoque, debitarEstoqueVendas: c.debitar_estoque_vendas,
        } as ShopeeChannel
        r = await syncCatalogoShopee(sb, canal)
      } else if (c.plataforma === 'mercadolivre') {
        const canal: MLChannel = {
          id: c.id, empresaId: c.empresa_id, sellerId: c.seller_id,
          accessToken: c.access_token, refreshToken: c.refresh_token, tokenExpiraEm: c.token_expira_em,
          mlScanScrollId: c.ml_scan_scroll_id,
        } as MLChannel
        r = await syncCatalogoML(sb, canal)
      } else {
        // Plataforma sem importação implementada. Registrar em vez de pular
        // calado: canal que nunca é lido some do radar do gestor.
        resultados.push({ ...base, ok: false, erro: `Plataforma "${c.plataforma}" ainda não tem importação de anúncios.` })
        continue
      }

      // "0 encontrados" é resultado legítimo (loja sem anúncio); só é erro
      // quando achou itens e não conseguiu gravar nenhum.
      const status = r.upserted > 0 || r.totalFound === 0 ? 'ok' : 'erro'
      await sb.from('marketplace_sync_log').insert({
        canal_id: c.id, tipo: 'produto_sync', status,
        mensagem: `[retrato diário] Encontrados: ${r.totalFound} · Atualizados: ${r.upserted} · Falhas: ${r.failed.length}${r.truncated ? ' · Truncado' : ''}`,
        detalhes: r,
      })
      await sb.from('marketplace_canais')
        .update({ ultima_sincronizacao: new Date().toISOString() }).eq('id', c.id)

      resultados.push({
        ...base, ok: status === 'ok',
        encontrados: r.totalFound, atualizados: r.upserted,
        falhas: r.failed.length, truncado: !!r.truncated,
      })
    } catch (e: any) {
      const erro = e?.message ?? 'Erro ao atualizar os anúncios'
      await sb.from('marketplace_sync_log').insert({
        canal_id: c.id, tipo: 'produto_sync', status: 'erro',
        mensagem: `[retrato diário] ${erro}`, detalhes: { error: erro },
      })
      // Um canal que falha não derruba os outros.
      resultados.push({ ...base, ok: false, erro })
    }
  }

  return NextResponse.json({
    ok: true,
    canais: resultados.length,
    comFalha: resultados.filter(r => !r.ok).length,
    resultados,
  })
}
