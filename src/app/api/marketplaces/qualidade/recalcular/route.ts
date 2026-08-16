import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { colunasQualidade } from '@/lib/marketplace/qualidade'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const maxDuration = 300

// Recalcula a qualidade dos anúncios que já estão no banco.
//
// Daqui pra frente cada sincronização já grava a nota, mas os 8.900 anúncios
// existentes só seriam avaliados quando a varredura passasse por eles de
// novo. Esta rota adianta isso.
//
// Processa por página e para sozinha antes do teto de tempo da Vercel,
// devolvendo quantos faltam. Uma função morta no meio não deixa rastro; sair
// por conta própria com o número na mão deixa.

const ORCAMENTO_MS = 240_000
const PAGINA = 300

export async function POST(req: Request) {
  const inicio = Date.now()
  const body = await req.json().catch(() => ({}))
  // Por padrão só o que ainda não tem nota. `tudo: true` reavalia todos —
  // útil quando os critérios do checklist mudam.
  const soPendentes: boolean = body?.tudo !== true

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canais } = await sb.from('marketplace_canais')
    .select('id, plataforma').eq('empresa_id', empresaId)
  const plataformaPorCanal = new Map((canais ?? []).map(c => [c.id, c.plataforma]))
  if (plataformaPorCanal.size === 0) {
    return NextResponse.json({ ok: true, avaliados: 0, restantes: 0, mensagem: 'Nenhum canal configurado.' })
  }
  const idsCanal = [...plataformaPorCanal.keys()]

  let avaliados = 0
  let acabou = false

  while (Date.now() - inicio < ORCAMENTO_MS) {
    // Sempre a primeira página: quem foi avaliado sai do filtro de pendentes,
    // então o offset não avança sozinho. Com `tudo`, pagina de verdade.
    let q = sb.from('marketplace_anuncios')
      .select('id, canal_id, dados_brutos')
      .in('canal_id', idsCanal)
      .not('dados_brutos', 'is', null)
      .limit(PAGINA)
    if (soPendentes) q = q.is('qualidade_em', null)
    else q = q.order('qualidade_em', { ascending: true, nullsFirst: true })

    const { data: lote, error } = await q
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    if (!lote?.length) { acabou = true; break }

    for (const a of lote) {
      const plataforma = plataformaPorCanal.get(a.canal_id) ?? 'shopee'
      const cols = colunasQualidade(plataforma, a.dados_brutos)
      await sb.from('marketplace_anuncios').update(cols).eq('id', a.id)
      avaliados++
    }

    // Reavaliação completa não tem critério de parada natural — uma volta só.
    if (!soPendentes) { acabou = true; break }
  }

  const { count: restantes } = await sb.from('marketplace_anuncios')
    .select('id', { count: 'exact', head: true })
    .in('canal_id', idsCanal).not('dados_brutos', 'is', null).is('qualidade_em', null)

  return NextResponse.json({
    ok: true,
    avaliados,
    restantes: restantes ?? 0,
    concluido: acabou && (restantes ?? 0) === 0,
    duracaoSegundos: Math.round((Date.now() - inicio) / 1000),
  })
}
