import { NextResponse } from 'next/server'
import { canalShopeeDaSessao } from '@/lib/anuncios/canalShopeeDaSessao'
import { buscarCategoriasFolhaPorNome } from '@/lib/shopee/listing'
import { refreshAccessTokenIfNeeded } from '@/lib/shopee/client'
import type { ShopeeChannel } from '@/lib/shopee/types'

// Busca de categoria da Shopee pelo nome — o "trocar" da publicação em lote.
export const maxDuration = 30

export async function POST(req: Request) {
  const { canalId, termo } = await req.json().catch(() => ({}))
  const g = await canalShopeeDaSessao(canalId)
  if (!g.ok) return NextResponse.json({ ok: false, erro: g.erro }, { status: g.status })
  try {
    const canal = await refreshAccessTokenIfNeeded(g.sb, {
      id: g.canalRow.id, empresaId: g.canalRow.empresa_id, sellerId: g.canalRow.seller_id,
      accessToken: g.canalRow.access_token, refreshToken: g.canalRow.refresh_token, tokenExpiraEm: g.canalRow.token_expira_em,
    } as ShopeeChannel)
    const categorias = await buscarCategoriasFolhaPorNome({ sb: g.sb, canal }, String(termo ?? ''))
    return NextResponse.json({ ok: true, categorias })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'erro na busca' }, { status: 400 })
  }
}
