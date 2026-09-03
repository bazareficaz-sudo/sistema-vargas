import { NextResponse } from 'next/server'
import { camposPausaManual, camposReativacao } from '@/lib/marketplace/pausa'
import { createClient } from '@/lib/supabase/server'
import { refreshAccessTokenIfNeeded } from '@/lib/shopee/client'
import { unlistItems } from '@/lib/shopee/write'
import type { ShopeeChannel } from '@/lib/shopee/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const { canalId, anuncioIds, acao } = await req.json()
  if (!canalId || !Array.isArray(anuncioIds) || anuncioIds.length === 0) {
    return NextResponse.json({ ok: false, erro: 'canalId/anuncioIds ausente' }, { status: 400 })
  }
  if (acao !== 'pausar' && acao !== 'ativar') {
    return NextResponse.json({ ok: false, erro: 'acao inválida' }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .eq('plataforma', 'shopee')
    .single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })
  }

  const { data: anuncios } = await sb
    .from('marketplace_anuncios')
    .select('id, id_externo')
    .eq('empresa_id', empresaId)
    .eq('canal_id', canalId)
    .in('id', anuncioIds)

  const todos = anuncios ?? []
  const comIdExterno = todos.filter(a => a.id_externo)
  const semIdExterno = todos.length - comIdExterno.length
  if (comIdExterno.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum anúncio selecionado veio de sincronização (sem ID externo).' }, { status: 400 })
  }

  let canal: ShopeeChannel = {
    id: canalRow.id,
    empresaId: canalRow.empresa_id,
    sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token,
    refreshToken: canalRow.refresh_token,
    tokenExpiraEm: canalRow.token_expira_em,
  }

  try {
    canal = await refreshAccessTokenIfNeeded(sb, canal)
    const unlist = acao === 'pausar'
    const idExternoParaLocal = new Map<number, string>(comIdExterno.map(a => [Number(a.id_externo), a.id]))

    const resultados = await unlistItems({ sb, canal }, [...idExternoParaLocal.keys()], unlist)
    const sucessos = resultados.filter(r => r.ok)
    const falhas = resultados.filter(r => !r.ok)

    const idsLocaisSucesso = sucessos.map(r => idExternoParaLocal.get(r.itemId)).filter(Boolean) as string[]
    if (idsLocaisSucesso.length > 0) {
      await sb.from('marketplace_anuncios')
        // PAUSA MANUAL FICA MARCADA. Esta rota so e chamada por uma pessoa
        // na tela; a fila automatica usa outro caminho. A marca e o que
        // impede a reposicao de estoque de religar um anuncio que alguem
        // tirou do ar de proposito.
        .update(unlist ? camposPausaManual(user.id) : camposReativacao())
        .in('id', idsLocaisSucesso)
    }

    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId,
      tipo: acao === 'pausar' ? 'pausar_anuncios' : 'ativar_anuncios',
      status: falhas.length === 0 ? 'ok' : 'erro',
      mensagem: `${sucessos.length} atualizado(s), ${falhas.length} falha(s)` +
        (semIdExterno > 0 ? `, ${semIdExterno} ignorado(s) (sem ID externo)` : ''),
      detalhes: { sucessos: sucessos.length, falhas: falhas.map(f => ({ itemId: f.itemId, erro: f.erro })) },
    })

    return NextResponse.json({
      ok: falhas.length === 0,
      atualizados: idsLocaisSucesso,
      falhasCount: falhas.length,
      semIdExterno,
      erros: [...new Set(falhas.map(f => f.erro))],
    })
  } catch (e: any) {
    const erro = e?.message ?? 'Erro ao atualizar status na Shopee'
    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId,
      tipo: acao === 'pausar' ? 'pausar_anuncios' : 'ativar_anuncios',
      status: 'erro', mensagem: erro, detalhes: { error: erro },
    })
    return NextResponse.json({ ok: false, erro }, { status: 400 })
  }
}
