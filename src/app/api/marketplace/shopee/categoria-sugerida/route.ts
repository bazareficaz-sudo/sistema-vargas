import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCategoryTree, type CategoriaShopee } from '@/lib/shopee/listing'
import type { ShopeeChannel } from '@/lib/shopee/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Pré-seleção sem IA: reaproveita a categoria escolhida da última vez pra
// um produto com a mesma categoria interna da loja (marketplace_categoria_sugestao,
// gravada em criar-anuncio/route.ts após uma publicação bem-sucedida).
export async function POST(req: Request) {
  const { canalId, produtoCategoria } = await req.json()
  if (!canalId) return NextResponse.json({ ok: false, erro: 'canalId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  if (!produtoCategoria) return NextResponse.json({ ok: true, encontrado: false })

  const { data: sugestaoRow } = await sb
    .from('marketplace_categoria_sugestao')
    .select('categoria_ids')
    .eq('empresa_id', empresaId).eq('canal_id', canalId).eq('produto_categoria', produtoCategoria)
    .maybeSingle()

  const categoriaIds: number[] = sugestaoRow?.categoria_ids ?? []
  if (categoriaIds.length === 0) return NextResponse.json({ ok: true, encontrado: false })

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
    const ctx = { sb, canal }
    const opcoesPorNivel: CategoriaShopee[][] = []
    const caminho: CategoriaShopee[] = []
    let parentCategoryId: number | undefined = undefined

    for (const idAlvo of categoriaIds) {
      const opcoes = await getCategoryTree(ctx, parentCategoryId)
      const encontrada = opcoes.find(o => o.category_id === idAlvo)
      if (!encontrada) break // categoria pode ter mudado na Shopee — para aqui, resto fica manual
      opcoesPorNivel.push(opcoes)
      caminho.push(encontrada)
      if (!encontrada.has_children) break
      parentCategoryId = encontrada.category_id
    }

    const resolvidoAteFolha = caminho.length > 0 && !caminho[caminho.length - 1].has_children
    return NextResponse.json({ ok: true, encontrado: caminho.length > 0, opcoesPorNivel, caminho, resolvidoAteFolha })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao buscar sugestão de categoria' }, { status: 400 })
  }
}
