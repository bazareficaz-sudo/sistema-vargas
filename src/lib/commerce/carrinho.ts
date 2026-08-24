import { db, limpar } from './db'
import { disponibilidadeAoVivo } from './catalogo'
import type { ItemCarrinhoConferido, Loja, ProdutoCard } from './tipos'

// Conferência do carrinho.
//
// Na Fase 1 o carrinho do visitante vive no navegador (localStorage). Isso é
// adequado — e as tabelas `loja_carrinhos`/`loja_carrinho_itens` já existem
// para a Fase 3 sincronizar sem migração no meio do checkout.
//
// O ponto que NÃO pode ficar no navegador é a conferência. O que o cliente
// guardou pode ter envelhecido: o preço mudou, o estoque acabou, o produto
// foi despublicado. Confiar no que voltou do localStorage é como uma loja
// vende por um preço que não pratica mais.
//
// Regra de conduta desta conferência: nunca alterar valor em silêncio.
// Se mudou, o carrinho mostra que mudou.

export type ItemPedido = { produtoId: string; quantidade: number; precoVisto?: number }

function paraCard(r: Record<string, any>): ProdutoCard {
  return {
    lojaProdutoId: r.loja_produto_id,
    produtoId: r.produto_id,
    slug: r.slug,
    nome: r.nome,
    marca: r.marca ?? null,
    imagemUrl: r.imagem_url ?? null,
    preco: Number(r.preco ?? 0),
    precoDe: r.preco_de != null ? Number(r.preco_de) : null,
    precoPix: r.preco_pix != null ? Number(r.preco_pix) : null,
    estoquePublicavel: Number(r.estoque_publicavel ?? 0),
    destaque: !!r.destaque,
  }
}

export type CarrinhoConferido = {
  itens: ItemCarrinhoConferido[]
  subtotal: number
  quantidadeTotal: number
  /** Itens que sumiram do catálogo entre o "adicionar" e agora. */
  removidos: string[]
  temAviso: boolean
}

export async function conferirCarrinho(loja: Loja, pedidos: ItemPedido[]): Promise<CarrinhoConferido> {
  const vazio: CarrinhoConferido = {
    itens: [], subtotal: 0, quantidadeTotal: 0, removidos: [], temAviso: false,
  }
  if (pedidos.length === 0) return vazio

  // Teto de itens distintos. Uma lista vinda do navegador é entrada do
  // usuário: sem limite, um localStorage adulterado vira uma consulta `IN`
  // com milhares de ids.
  const limitados = pedidos.slice(0, 100)
  const ids = [...new Set(limitados.map(p => p.produtoId))]

  const { data } = await db()
    .from('loja_vitrine_produtos')
    .select('*')
    .eq('loja_id', loja.id)
    .eq('status', 'publicado')
    .in('produto_id', ids)

  const porId = new Map<string, ProdutoCard>()
  for (const l of (data ?? []) as Record<string, any>[]) {
    porId.set(l.produto_id, paraCard(limpar(l)))
  }

  const disp = await disponibilidadeAoVivo(loja, [...porId.keys()])

  const itens: ItemCarrinhoConferido[] = []
  const removidos: string[] = []

  for (const p of limitados) {
    const produto = porId.get(p.produtoId)
    if (!produto) { removidos.push(p.produtoId); continue }

    const disponivel = disp.get(p.produtoId) ?? 0
    const solicitada = Math.max(1, Math.floor(Number(p.quantidade) || 1))

    // Teto por compra: o do produto, se houver, senão o da loja.
    const teto = loja.limiteMaximoPorCompra ?? Infinity

    // Vender sem estoque é decisão da loja, não do carrinho.
    const maximo = loja.permitirVendaSemEstoque
      ? Math.min(solicitada, teto)
      : Math.min(solicitada, disponivel, teto)

    const quantidade = Math.max(0, Math.floor(maximo))
    const indisponivel = quantidade === 0

    const precoVisto = p.precoVisto != null ? Number(p.precoVisto) : null
    // Centavo de diferença por arredondamento não é "o preço mudou".
    const precoMudou = precoVisto != null && Math.abs(precoVisto - produto.preco) > 0.005

    itens.push({
      produto,
      quantidade,
      quantidadeSolicitada: solicitada,
      disponivel,
      precoAnterior: precoMudou ? precoVisto : null,
      precoMudou,
      quantidadeAjustada: !indisponivel && quantidade < solicitada,
      indisponivel,
      subtotal: quantidade * produto.preco,
    })
  }

  const subtotal = itens.reduce((s, i) => s + i.subtotal, 0)
  const quantidadeTotal = itens.reduce((s, i) => s + i.quantidade, 0)
  const temAviso =
    removidos.length > 0 || itens.some(i => i.precoMudou || i.quantidadeAjustada || i.indisponivel)

  return { itens, subtotal, quantidadeTotal, removidos, temAviso }
}
