import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { refreshAccessTokenIfNeeded } from '@/lib/shopee/client'
import { sincronizarPromocoesShopee } from '@/lib/marketplace/promocoesSync'
import type { ShopeeChannel } from '@/lib/shopee/types'

// Puxa as campanhas de desconto da Shopee para o espelho local.
//
// Só leitura: nada é criado, alterado ou encerrado na plataforma por esta
// rota. É a fatia 1 do módulo de promoções, e existe para revelar como as
// campanhas reais desta loja são antes de a tela passar a criá-las.
export const maxDuration = 120

export async function POST(req: Request) {
  const { canalId, situacao } = await req.json()
  if (!canalId) return NextResponse.json({ ok: false, erro: 'canalId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'shopee').single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })
  }

  let canal: ShopeeChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token,
    tokenExpiraEm: canalRow.token_expira_em,
  } as ShopeeChannel

  try {
    canal = await refreshAccessTokenIfNeeded(sb, canal)
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Falha ao renovar o token da Shopee' }, { status: 400 })
  }

  const r = await sincronizarPromocoesShopee(sb, canal, empresaId, canalId, situacao ?? 'all')

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: 'promocoes_sync',
    status: r.ok ? 'ok' : 'erro',
    mensagem: r.ok
      ? `${r.campanhas} campanha(s), ${r.itens} item(ns)${r.itensSemAnuncio ? ` · ${r.itensSemAnuncio} sem anúncio no sistema` : ''}`
      : r.erro,
    detalhes: r,
  })

  if (!r.ok) return NextResponse.json({ ok: false, erro: r.erro }, { status: 400 })
  return NextResponse.json(r)
}
