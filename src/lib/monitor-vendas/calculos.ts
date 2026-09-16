// Matemática do Monitor de Vendas — isolada da tela de propósito, para poder
// testar sem montar UI nem Supabase.
//
// `vendas.itens` (jsonb) NUNCA guarda o custo do produto: só preço, desconto e
// subtotal. O custo real usado aqui é sempre o do catálogo no momento em que a
// tela é aberta — não é "fallback para o caso raro", é o ÚNICO caminho que
// existe. Por isso um produto excluído ou com custo zerado no cadastro vira
// "⚠ Custo 0" em vez de um lucro inventado.

export type ProdutoCache = {
  id: string
  nome: string
  sku: string | null
  custo: number
  estoque: number
  estoqueMinimo: number
  tipo: string | null
  ativo: boolean
}

export type ItemVendido = {
  produto_id: string | null
  produto_nome: string
  produto_sku: string | null
  quantidade: number
  preco_unitario: number
  desconto?: number | null
  subtotal: number
}

export type KitComponente = { produtoId: string; quantidade: number; controlaEstoque: boolean }

export type IndiceProdutos = {
  porId: Map<string, ProdutoCache>
  porSku: Map<string, ProdutoCache>
  porNome: Map<string, ProdutoCache>
}

export function construirIndiceProdutos(produtos: ProdutoCache[]): IndiceProdutos {
  const porId = new Map<string, ProdutoCache>()
  const porSku = new Map<string, ProdutoCache>()
  const porNome = new Map<string, ProdutoCache>()
  for (const p of produtos) {
    porId.set(p.id, p)
    if (p.sku) porSku.set(p.sku, p)
    porNome.set(p.nome.trim().toLowerCase(), p)
  }
  return { porId, porSku, porNome }
}

/**
 * Acha o produto no catálogo carregado — por id, depois SKU, depois nome
 * exato. Um item de venda antiga sobrevive a produto renomeado (casa pelo id
 * ou SKU) e a produto com id trocado por reimportação (casa pelo nome).
 */
export function buscarProduto(
  indice: IndiceProdutos,
  item: { produto_id: string | null; produto_sku: string | null; produto_nome: string },
): ProdutoCache | undefined {
  if (item.produto_id) {
    const p = indice.porId.get(item.produto_id)
    if (p) return p
  }
  if (item.produto_sku) {
    const p = indice.porSku.get(item.produto_sku)
    if (p) return p
  }
  return indice.porNome.get(item.produto_nome.trim().toLowerCase())
}

/**
 * Estoque de um produto — para kit, o piso dos componentes (mesma regra de
 * `src/lib/produtos/kit.ts`, só que síncrona a partir do cache já carregado,
 * porque aqui não dá para fazer uma ida ao banco por linha da tabela).
 * Componente marcado como "não controla estoque" nunca limita a conta.
 */
export function estoqueDoProduto(
  produto: ProdutoCache,
  componentesPorKit: Map<string, KitComponente[]>,
  indice: IndiceProdutos,
): number {
  if (produto.tipo !== 'kit') return produto.estoque
  const componentes = componentesPorKit.get(produto.id)
  if (!componentes || componentes.length === 0) return produto.estoque

  let minimo = Infinity
  for (const c of componentes) {
    if (!c.controlaEstoque) continue
    const componente = indice.porId.get(c.produtoId)
    const estoqueComponente = componente?.estoque ?? 0
    minimo = Math.min(minimo, Math.floor(estoqueComponente / c.quantidade))
  }
  return minimo === Infinity ? 0 : Math.max(0, minimo)
}

export type CustoItem = { custo: number; semCusto: boolean; produto: ProdutoCache | undefined }

/** Custo unitário de um item vendido — sempre do catálogo (ver cabeçalho do arquivo). */
export function custoDoItem(
  item: ItemVendido,
  indice: IndiceProdutos,
  componentesPorKit: Map<string, KitComponente[]>,
): CustoItem {
  const produto = buscarProduto(indice, item)
  if (!produto) return { custo: 0, semCusto: true, produto: undefined }
  const custo = produto.tipo === 'kit'
    ? Number(produto.custo ?? 0) // kit: custo já é a soma dos componentes, gravado por recalcularKitsQueUsam
    : Number(produto.custo ?? 0)
  return { custo, semCusto: custo <= 0, produto }
}

export type LucroVenda = { custoTotal: number; lucro: number; margem: number; temItemSemCusto: boolean }

/** lucro = total − custo − desconto; margem = lucro / total. */
export function calcularLucroVenda(
  total: number,
  descontoTotal: number,
  itens: ItemVendido[],
  indice: IndiceProdutos,
  componentesPorKit: Map<string, KitComponente[]>,
): LucroVenda {
  let custoTotal = 0
  let temItemSemCusto = false
  for (const item of itens) {
    const { custo, semCusto } = custoDoItem(item, indice, componentesPorKit)
    custoTotal += custo * Number(item.quantidade ?? 0)
    if (semCusto) temItemSemCusto = true
  }
  const lucro = total - custoTotal - descontoTotal
  const margem = total > 0 ? (lucro / total) * 100 : 0
  return { custoTotal, lucro, margem, temItemSemCusto }
}

/** Markup do item = quanto o preço de venda passa do custo, em %. null = sem custo pra calcular. */
export function markupItem(precoUnitario: number, custoUnitario: number): number | null {
  if (custoUnitario <= 0) return null
  return ((precoUnitario - custoUnitario) / custoUnitario) * 100
}

export type CorBadge = 'verde' | 'laranja' | 'vermelho'

export function corMarkup(markup: number | null): CorBadge {
  if (markup === null) return 'laranja' // "Custo 0" — não é bom nem ruim, é desconhecido
  if (markup < 0) return 'vermelho'
  if (markup < 20) return 'laranja'
  return 'verde'
}

export function corMargem(margemPct: number): CorBadge {
  if (margemPct < 0) return 'vermelho'
  if (margemPct < 15) return 'laranja'
  return 'verde'
}

export type SituacaoEstoque = 'zerado' | 'baixo' | 'ok' | 'nao_vinculado'

/**
 * `produtoId` nulo (venda que nunca teve produto casado, ex.: item avulso)
 * não é a mesma coisa que "produto excluído do cadastro" — só o segundo caso
 * é "não vinculado". Por isso quem chama passa se achou o produto no índice.
 */
export function situacaoEstoque(achouNoCadastro: boolean, estoqueAtual: number, estoqueMinimo: number): SituacaoEstoque {
  if (!achouNoCadastro) return 'nao_vinculado'
  if (estoqueAtual <= 0) return 'zerado'
  if (estoqueMinimo > 0 && estoqueAtual <= estoqueMinimo) return 'baixo'
  return 'ok'
}

/**
 * Sugestão de compra = quanto falta para o mínimo, já contando o que saiu no
 * período (senão a sugestão ignora a demanda que acabou de esvaziar a
 * prateleira). Sem mínimo cadastrado, sugere repor a própria quantidade
 * vendida — não há outro número para ancorar a sugestão.
 */
export function sugestaoDeCompra(estoqueAtual: number, estoqueMinimo: number, qtdVendidaPeriodo: number): number {
  if (estoqueMinimo > 0) {
    return Math.max(0, Math.ceil(estoqueMinimo - estoqueAtual + qtdVendidaPeriodo))
  }
  return Math.max(0, Math.ceil(qtdVendidaPeriodo))
}
