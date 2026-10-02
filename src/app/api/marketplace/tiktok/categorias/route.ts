import { NextResponse } from 'next/server'
import { canalTiktokDaSessao } from '@/lib/tiktok/canalDaSessao'
import { buscarCategorias, buscarMarcas, detalhesDaCategoria, recomendarCategoria } from '@/lib/tiktok/listing'

// Tudo que a tela de criar anúncio TikTok consulta antes de publicar:
//   acao 'recomendar' → categoria sugerida pela TikTok para o título
//   acao 'buscar'     → categorias-folha pelo nome
//   acao 'detalhes'   → atributos, marcas e regras da categoria
//   acao 'marcas'     → marcas da categoria pelo nome
export const maxDuration = 60

export async function POST(req: Request) {
  const { canalId, acao, titulo, termo, categoryId, marca } = await req.json()
  const g = await canalTiktokDaSessao(canalId)
  if (!g.ok) return NextResponse.json({ ok: false, erro: g.erro }, { status: g.status })

  try {
    if (acao === 'recomendar') {
      if (!String(titulo ?? '').trim()) return NextResponse.json({ ok: true, categoria: null })
      return NextResponse.json({ ok: true, categoria: await recomendarCategoria(g.sb, g.canal, String(titulo)) })
    }
    if (acao === 'buscar') {
      return NextResponse.json({ ok: true, categorias: await buscarCategorias(g.sb, g.canal, String(termo ?? '')) })
    }
    if (acao === 'detalhes' && categoryId) {
      return NextResponse.json({ ok: true, ...(await detalhesDaCategoria(g.sb, g.canal, String(categoryId))) })
    }
    if (acao === 'marcas' && categoryId) {
      return NextResponse.json({ ok: true, marcas: await buscarMarcas(g.sb, g.canal, String(categoryId), String(marca ?? '')) })
    }
    return NextResponse.json({ ok: false, erro: 'Ação inválida' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: `TikTok: ${e?.message ?? 'erro na consulta'}` }, { status: 400 })
  }
}
