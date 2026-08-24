import { NextResponse } from 'next/server'
import { lojaAtual } from '@/lib/commerce/loja'
import { sugerir } from '@/lib/commerce/catalogo'

// Sugestões da barra de busca.
//
// Rota pública, chamada a cada 300ms de digitação. Duas travas obrigatórias:
// termo curto não consulta nada, e o resultado é o mínimo (nome, imagem,
// preço) — nunca a linha inteira do produto.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const loja = await lojaAtual()
  if (!loja) return NextResponse.json([], { status: 404 })

  const termo = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 80)
  if (termo.length < 2) return NextResponse.json([])

  try {
    const itens = await sugerir(loja, termo)
    return NextResponse.json(itens, {
      // 60s de cache na borda: a mesma palavra é digitada por muita gente, e
      // o resultado não muda de segundo em segundo.
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch {
    // Autocomplete que falha devolve lista vazia, não erro: quebrar a
    // digitação por causa de uma sugestão seria pior que não sugerir.
    return NextResponse.json([])
  }
}
