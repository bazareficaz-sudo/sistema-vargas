import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomendarCategoria } from '@/lib/shopee/listing'
import type { ShopeeChannel } from '@/lib/shopee/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Ferramenta oficial da Shopee (category_recommend) — 1º fallback de
// pré-seleção de categoria, antes da "lembrada" e da dedução por palavras.
export async function POST(req: Request) {
  const { canalId, produtoNome } = await req.json()
  if (!canalId || !produtoNome) return NextResponse.json({ ok: false, erro: 'canalId/produtoNome ausente' }, { status: 400 })

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

  if (!canalRow?.access_token) return NextResponse.json({ ok: true, encontrado: false })

  const canal: ShopeeChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }

  try {
    const resultado = await recomendarCategoria({ sb, canal }, produtoNome)
    if (!resultado) return NextResponse.json({ ok: true, encontrado: false })
    return NextResponse.json({ ok: true, encontrado: true, ...resultado })
  } catch (e: any) {
    // Falha aqui não deve travar o fluxo — outras camadas de pré-seleção
    // seguem tentando, então nunca bloqueia com esse erro na tela.
    return NextResponse.json({ ok: true, encontrado: false })
  }
}
