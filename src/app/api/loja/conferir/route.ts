import { NextResponse } from 'next/server'
import { lojaAtual } from '@/lib/commerce/loja'
import { conferirCarrinho, type ItemPedido } from '@/lib/commerce/carrinho'

// Conferência do carrinho, no servidor.
//
// O carrinho do visitante vive no navegador (Fase 1), então o cliente manda
// o que ele guardou e o servidor devolve o que é VERDADE agora: preço atual,
// saldo atual, e o que saiu do catálogo no meio do caminho.
//
// Nada do que chega aqui é aceito como valor. `precoVisto` serve só para
// comparar e avisar "o preço mudou" — nunca para cobrar. Se essa distinção
// se perder, a loja passa a aceitar o preço que o navegador mandar.

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const loja = await lojaAtual()
  if (!loja) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  let corpo: unknown
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido' }, { status: 400 })
  }

  const bruto = (corpo as { itens?: unknown })?.itens
  if (!Array.isArray(bruto)) {
    return NextResponse.json({ erro: 'Lista de itens ausente' }, { status: 400 })
  }

  // Validação item a item. O corpo vem do navegador: pode ter sido montado à
  // mão, e um `quantidade: -5` ou um id que não é uuid não pode chegar ao banco.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const itens: ItemPedido[] = bruto
    .filter((i: unknown): i is Record<string, unknown> => !!i && typeof i === 'object')
    .filter(i => typeof i.produtoId === 'string' && UUID.test(i.produtoId))
    .slice(0, 100)
    .map(i => ({
      produtoId: i.produtoId as string,
      quantidade: Math.min(Math.max(Math.floor(Number(i.quantidade) || 1), 1), 9999),
      precoVisto: Number.isFinite(Number(i.precoVisto)) ? Number(i.precoVisto) : undefined,
    }))

  try {
    const resultado = await conferirCarrinho(loja, itens)
    return NextResponse.json(resultado, {
      // Carrinho nunca é cacheado, em lugar nenhum do caminho.
      headers: { 'Cache-Control': 'no-store, private' },
    })
  } catch (e) {
    // Log sem PII: id da loja e mensagem, nunca o conteúdo do carrinho.
    console.error('[loja] falha ao conferir carrinho', {
      lojaId: loja.id,
      erro: e instanceof Error ? e.message : 'desconhecido',
    })
    return NextResponse.json({ erro: 'Não foi possível conferir o carrinho' }, { status: 500 })
  }
}
