import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { refreshAccessTokenIfNeeded } from '@/lib/shopee/client'
import { pushPrecoEstoque, type AlvoPush } from '@/lib/shopee/write'
import type { ShopeeChannel } from '@/lib/shopee/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const { canalId, anuncioId } = await req.json()
  if (!canalId || !anuncioId) return NextResponse.json({ ok: false, erro: 'canalId/anuncioId ausente' }, { status: 400 })

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

  const { data: anuncio } = await sb
    .from('marketplace_anuncios')
    .select('id, empresa_id, canal_id, id_externo, tem_variacao, preco_venda, estoque_reservado')
    .eq('id', anuncioId)
    .eq('empresa_id', empresaId)
    .eq('canal_id', canalId)
    .single()

  if (!anuncio) return NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 })
  if (!anuncio.id_externo) return NextResponse.json({ ok: false, erro: 'Anúncio sem ID externo — não veio de sincronização.' }, { status: 400 })

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

    let alvos: AlvoPush[]
    if (anuncio.tem_variacao) {
      const { data: variacoes } = await sb
        .from('marketplace_anuncio_variacoes')
        .select('model_id, preco, estoque')
        .eq('anuncio_id', anuncio.id)
      alvos = (variacoes ?? []).map((v: any) => ({ modelId: v.model_id, preco: v.preco, estoque: v.estoque }))
    } else {
      alvos = [{ preco: anuncio.preco_venda, estoque: anuncio.estoque_reservado }]
    }

    const resultado = await pushPrecoEstoque({ sb, canal }, Number(anuncio.id_externo), alvos)
    const ok = resultado.precoOk && resultado.estoqueOk

    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId,
      tipo: 'push_preco_estoque',
      status: ok ? 'ok' : 'erro',
      mensagem: [
        resultado.precoOk ? null : `Preço: ${resultado.erroPreco}`,
        resultado.estoqueOk ? null : `Estoque: ${resultado.erroEstoque}`,
      ].filter(Boolean).join(' · ') || 'Preço e estoque enviados com sucesso.',
      detalhes: resultado,
    })

    if (ok) {
      await sb.from('marketplace_anuncios').update({
        ultima_atualizacao: new Date().toISOString(),
        sincronizado_em: new Date().toISOString(),
      }).eq('id', anuncio.id)
    }

    return NextResponse.json({ ok, ...resultado })
  } catch (e: any) {
    const erro = e?.message ?? 'Erro ao enviar para a Shopee'
    await sb.from('marketplace_sync_log').insert({
      canal_id: canalId, tipo: 'push_preco_estoque', status: 'erro', mensagem: erro, detalhes: { error: erro },
    })
    return NextResponse.json({ ok: false, erro }, { status: 400 })
  }
}
