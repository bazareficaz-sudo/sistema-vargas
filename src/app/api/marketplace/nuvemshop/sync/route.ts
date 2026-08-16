import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncCatalogo } from '@/lib/nuvemshop/sync'
import { COLUNAS_CANAL, montarCanal } from '@/lib/nuvemshop/canal'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const maxDuration = 300

export async function POST(req: Request) {
  const { canalId, maxItems } = await req.json()
  if (!canalId) return NextResponse.json({ ok: false, erro: 'canalId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow, error: erroCanal } = await sb
    .from('marketplace_canais')
    .select(COLUNAS_CANAL)
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'nuvemshop')
    .single()

  if (erroCanal || !canalRow) {
    return NextResponse.json({ ok: false, erro: 'Canal Nuvemshop não encontrado' }, { status: 404 })
  }
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autorização em Configurar.' }, { status: 400 })
  }

  const canal = montarCanal(canalRow)

  try {
    const resultado = await syncCatalogo(sb, canal, { maxItems: typeof maxItems === 'number' ? maxItems : undefined })

    const status = resultado.upserted > 0 || resultado.totalFound === 0 ? 'ok' : 'erro'
    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId,
      tipo: 'produto_sync',
      status,
      mensagem: `Encontrados: ${resultado.totalFound} · Sincronizados: ${resultado.upserted} · Falhas: ${resultado.failed.length}${resultado.truncated ? ' · Catálogo grande — parte ficou de fora desta rodada' : ''}`,
      detalhes: resultado,
    })

    await sb.from('marketplace_canais').update({ ultima_sincronizacao: new Date().toISOString() }).eq('id', canalId)

    return NextResponse.json({
      ok: true,
      totalFound: resultado.totalFound,
      upserted: resultado.upserted,
      failedCount: resultado.failed.length,
      failed: resultado.failed,
      truncated: resultado.truncated,
    })
  } catch (e: any) {
    const erro = e?.message ?? 'Erro ao sincronizar com a Nuvemshop'
    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId, tipo: 'produto_sync', status: 'erro', mensagem: erro, detalhes: { error: erro },
    })
    return NextResponse.json({ ok: false, erro }, { status: 400 })
  }
}
