import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deduzirCategoriaPorPalavras } from '@/lib/shopee/listing'
import type { ShopeeChannel } from '@/lib/shopee/types'

// Pré-seleção de categoria por dedução de palavras-chave — sem IA. Usado
// como 2º fallback (depois de marketplace_categoria_sugestao, que é uma
// escolha já confirmada antes; a dedução aqui é uma estimativa e sempre
// fica editável).
export async function POST(req: Request) {
  const { canalId, produtoNome, produtoCategoria } = await req.json()
  if (!canalId || !produtoNome) return NextResponse.json({ ok: false, erro: 'canalId/produtoNome ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
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
    const resultado = await deduzirCategoriaPorPalavras({ sb, canal }, produtoNome, produtoCategoria ?? null)
    if (!resultado) return NextResponse.json({ ok: true, encontrado: false })
    return NextResponse.json({ ok: true, encontrado: true, ...resultado })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao deduzir categoria' }, { status: 400 })
  }
}
