import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncCatalogo as syncCatalogoShopee } from '@/lib/shopee/sync'
import { syncCatalogo as syncCatalogoML } from '@/lib/mercadolivre/sync'
import { syncCatalogo as syncCatalogoNuvemshop } from '@/lib/nuvemshop/sync'
import { montarCanal as montarCanalNuvemshop } from '@/lib/nuvemshop/canal'
import {
  decidirAcao, prazoDaRodada, abrirLog, fecharLog, recuperarRodadasMortas,
} from '@/lib/marketplace/varredura'
import type { ShopeeChannel } from '@/lib/shopee/types'
import type { MLChannel } from '@/lib/mercadolivre/types'

// FASE 1 — retrato diário dos anúncios: marketplace → sistema.
//
// É deliberadamente SÓ LEITURA. Traz o que mudou lá fora — preço, estoque do
// canal, vendas, anúncio novo, anúncio encerrado ou pausado — e atualiza a
// situação aqui dentro. Não envia nada, não corrige nada, não republica nada.
// Isso é garantia estrutural, não intenção: `syncCatalogo` das três
// plataformas só importa funções de leitura (`shopeeGet`/`mlGet`/`nuvemshopGet`).
// Nenhuma função de escrita entra neste caminho.
//
// ── Por que roda a cada 20 min se é "diário" ────────────────
//
// Uma passagem completa não cabe em uma invocação: o teto da Vercel é 300s e
// são ~8.700 anúncios. Então a passagem é dividida. A cada 20 minutos esta
// rota:
//
//   • começa uma passagem nova, se hoje já passou das 3h e ainda não começou;
//   • continua a passagem em andamento, se houver;
//   • não faz nada, se a de hoje já terminou.
//
// Ou seja: uma passagem por dia, começando às 3h — só que executada em
// pedaços, cada um dentro do orçamento de tempo da função.
//
// ── O que estava errado antes ───────────────────────────────
//
// O cron da Shopee reimportava eternamente os mesmos 500 primeiros anúncios,
// porque a paginação sempre recomeçava do offset 0. E quando estourava o
// tempo, morria antes de gravar o log — falha invisível. Medido em 10/08/2026:
// os dois canais Shopee estavam 2 e 3 dias sem atualizar, sem nenhum erro na
// tela.

export const maxDuration = 300

type Resultado = {
  canalId: string
  canalNome: string
  plataforma: string
  acao: 'iniciar' | 'continuar' | 'nada'
  ok: boolean
  encontrados?: number
  atualizados?: number
  falhas?: number
  passeCompleto?: boolean
  itensNaPassagem?: number
  erro?: string
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const prazo = prazoDaRodada()

  // Fecha rodadas que ficaram penduradas em 'executando' (morreram por
  // timeout). Sem isso o canal ficaria travado em 'em_andamento' para sempre.
  await recuperarRodadasMortas(sb)

  // Sem filtro de plataforma de propósito: o critério é "canal conectado".
  const { data: canais, error: erroCanais } = await sb
    .from('marketplace_canais')
    .select('id, nome, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em, sincronizar_estoque, debitar_estoque_vendas, varredura_status, varredura_cursor, varredura_iniciada_em, varredura_itens, varredura_rodadas')
    .not('access_token', 'is', null)
    .order('nome')

  // Nunca tratar erro de consulta como "0 canais" em silêncio — já custou
  // dias de sincronização parada sem nenhum log nesta base.
  if (erroCanais) {
    return NextResponse.json({ ok: false, erro: erroCanais.message }, { status: 500 })
  }

  const agora = new Date()
  const resultados: Resultado[] = []

  for (const c of canais ?? []) {
    const base = { canalId: c.id, canalNome: c.nome, plataforma: c.plataforma }
    const acao = decidirAcao(c, agora)

    if (acao === 'nada') {
      resultados.push({ ...base, acao, ok: true })
      continue
    }

    // Uma rodada que já não tem orçamento não começa trabalho: só devolve o
    // controle para a próxima invocação continuar.
    if (Date.now() > prazo) {
      resultados.push({ ...base, acao, ok: true, erro: 'sem orçamento de tempo nesta rodada' })
      continue
    }

    const iniciandoPassagem = acao === 'iniciar'
    const cursor = iniciandoPassagem ? null : (c.varredura_cursor ?? null)
    const itensAntes = iniciandoPassagem ? 0 : (c.varredura_itens ?? 0)
    const rodadasAntes = iniciandoPassagem ? 0 : (c.varredura_rodadas ?? 0)

    const logId = await abrirLog(
      sb, c.id,
      iniciandoPassagem
        ? '[varredura] Iniciando passagem diária'
        : `[varredura] Continuando (${itensAntes} itens até aqui)`,
    )

    await sb.from('marketplace_canais').update({
      varredura_status: 'em_andamento',
      varredura_erro: null,
      ...(iniciandoPassagem
        ? { varredura_iniciada_em: agora.toISOString(), varredura_itens: 0, varredura_rodadas: 0, varredura_cursor: null }
        : {}),
    }).eq('id', c.id)

    try {
      let r: {
        totalFound: number; upserted: number; failed: any[]
        proximoCursor?: any; passeCompleto?: boolean
      }

      if (c.plataforma === 'shopee') {
        const canal: ShopeeChannel = {
          id: c.id, empresaId: c.empresa_id, sellerId: c.seller_id,
          accessToken: c.access_token, refreshToken: c.refresh_token, tokenExpiraEm: c.token_expira_em,
          sincronizarEstoque: c.sincronizar_estoque, debitarEstoqueVendas: c.debitar_estoque_vendas,
        } as ShopeeChannel
        r = await syncCatalogoShopee(sb, canal, { cursorInicial: cursor, prazo })
      } else if (c.plataforma === 'mercadolivre') {
        const canal: MLChannel = {
          id: c.id, empresaId: c.empresa_id, sellerId: c.seller_id,
          accessToken: c.access_token, refreshToken: c.refresh_token, tokenExpiraEm: c.token_expira_em,
        } as MLChannel
        r = await syncCatalogoML(sb, canal, {
          cursorInicial: typeof cursor === 'string' ? cursor : (cursor?.scrollId ?? null),
          prazo, persistirCursor: false,
        })
      } else if (c.plataforma === 'nuvemshop') {
        // Sem cursor: a importação da Nuvemshop percorre o catálogo inteiro
        // numa chamada só. Se um dia uma loja crescer a ponto de não caber,
        // isso aparece como rodada estourando o tempo — e aí ganha cursor
        // também, em vez de falhar em silêncio.
        r = await syncCatalogoNuvemshop(sb, montarCanalNuvemshop(c))
        r.passeCompleto = true
        r.proximoCursor = null
      } else {
        // Plataforma sem importação implementada. Registrar em vez de pular
        // calado: canal que nunca é lido some do radar do gestor.
        const erro = `Plataforma "${c.plataforma}" ainda não tem importação de anúncios.`
        await fecharLog(sb, logId, 'erro', `[varredura] ${erro}`)
        await sb.from('marketplace_canais').update({ varredura_status: 'erro', varredura_erro: erro }).eq('id', c.id)
        resultados.push({ ...base, acao, ok: false, erro })
        continue
      }

      const passeCompleto = r.passeCompleto !== false
      const itensTotal = itensAntes + r.totalFound
      const rodadas = rodadasAntes + 1

      await sb.from('marketplace_canais').update({
        varredura_status: passeCompleto ? 'concluida' : 'em_andamento',
        varredura_cursor: passeCompleto ? null : (r.proximoCursor ?? null),
        varredura_itens: itensTotal,
        varredura_rodadas: rodadas,
        varredura_ultimo_em: new Date().toISOString(),
        ...(passeCompleto ? { varredura_concluida_em: new Date().toISOString() } : {}),
        // `ultima_sincronizacao` continua marcando o último contato com o
        // canal — é o que a tela de Anúncios mostra hoje.
        ultima_sincronizacao: new Date().toISOString(),
      }).eq('id', c.id)

      const resumo = passeCompleto
        ? `[varredura] Passagem concluída · ${itensTotal} anúncios em ${rodadas} rodada(s) · Atualizados nesta: ${r.upserted} · Falhas: ${r.failed.length}`
        : `[varredura] Parcial · ${r.totalFound} nesta rodada (${itensTotal} na passagem) · Falhas: ${r.failed.length} · continua na próxima`

      // "0 encontrados" é resultado legítimo (loja sem anúncio); só é erro
      // quando achou itens e não conseguiu gravar nenhum.
      const status = r.totalFound === 0 || r.upserted > 0 ? 'ok' : 'erro'
      await fecharLog(sb, logId, status, resumo, { ...r, itensTotal, rodadas })

      resultados.push({
        ...base, acao, ok: status === 'ok',
        encontrados: r.totalFound, atualizados: r.upserted, falhas: r.failed.length,
        passeCompleto, itensNaPassagem: itensTotal,
      })
    } catch (e: any) {
      const erro = e?.message ?? 'Erro ao atualizar os anúncios'
      await fecharLog(sb, logId, 'erro', `[varredura] ${erro}`, { error: erro })
      // Conta a rodada mesmo tendo falhado e PRESERVA o cursor: a próxima
      // invocação retoma de onde parou, até o limite de tentativas do dia.
      // Zerar o cursor aqui faria uma instabilidade de segundos custar a
      // releitura do catálogo inteiro.
      await sb.from('marketplace_canais').update({
        varredura_status: 'erro', varredura_erro: erro,
        varredura_rodadas: rodadasAntes + 1,
        varredura_itens: itensAntes,
        varredura_ultimo_em: new Date().toISOString(),
      }).eq('id', c.id)
      // Um canal que falha não derruba os outros.
      resultados.push({ ...base, acao, ok: false, erro })
    }
  }

  return NextResponse.json({
    ok: true,
    canais: resultados.length,
    trabalharam: resultados.filter(r => r.acao !== 'nada').length,
    comFalha: resultados.filter(r => !r.ok).length,
    resultados,
  })
}
