// LISTA DE COMPRA: faltas do balcão + produtos abaixo do mínimo, num lugar só.
//
// Duas fontes, tratadas de jeitos diferentes de propósito:
//
//   · FALTA/ENCOMENDA do vendedor é registro (tabela faltas): tem data,
//     cliente, quem anotou, e espera o "Chegou" para avisar alguém.
//   · ABAIXO DO MÍNIMO ("Automático") NÃO é gravado: é calculado na hora a
//     partir do estoque. Quando a nota de entrada repõe, a linha some sozinha
//     — sem ninguém limpar e sem rascunho esquecido. (A automação antiga
//     gravava um rascunho por dia e deixava produto já reposto lá.)
//
// O fornecedor também é calculado na hora: o padrão do cadastro; sem ele, o
// preferencial; sem ele, o da última compra. Corrigir o cadastro muda a
// lista na mesma hora.

export type FornecedorResolvido = { id: string; nome: string; origem: 'padrao' | 'preferencial' | 'ultima_compra' }

export type HistoricoFornecedor = {
  fornecedor_id: string
  ultima_compra_em: string | null
  preferencial: boolean | null
  custo_ultimo?: number | null
}

/** Status de falta que ainda precisa ser COMPRADA (o resto já foi pedido ou chegou). */
export const PRECISA_COMPRAR = ['pendente', 'em_analise', 'em_compra', 'notificado']

export function resolverFornecedorId(
  padraoId: string | null | undefined,
  historico: HistoricoFornecedor[],
): { id: string; origem: FornecedorResolvido['origem'] } | null {
  if (padraoId) return { id: padraoId, origem: 'padrao' }
  const pref = historico.find(h => h.preferencial)
  if (pref) return { id: pref.fornecedor_id, origem: 'preferencial' }
  const ultima = [...historico]
    .filter(h => h.ultima_compra_em)
    .sort((a, b) => (b.ultima_compra_em ?? '').localeCompare(a.ultima_compra_em ?? ''))[0]
  return ultima ? { id: ultima.fornecedor_id, origem: 'ultima_compra' } : null
}

export function abaixoDoMinimo(estoque: number | null | undefined, minimo: number | null | undefined): boolean {
  const m = Number(minimo ?? 0)
  return m > 0 && Number(estoque ?? 0) < m
}

/** Quanto falta para chegar ao mínimo. Nunca menos de 1. */
export function sugestaoReposicao(estoque: number | null | undefined, minimo: number | null | undefined): number {
  return Math.max(1, Math.ceil(Number(minimo ?? 0) - Number(estoque ?? 0)))
}

export type FaltaAberta = {
  id: string
  produto_id: string | null
  quantidade_solicitada: number
  status: string
  tipo: string
}

export type ProdutoCompra = {
  id: string; nome: string; sku: string | null; unidade: string | null
  estoque: number; estoque_minimo: number; preco_custo: number; preco_venda?: number | null
}

export type LinhaCompra = {
  produtoId: string
  nome: string
  sku: string | null
  unidade: string
  estoque: number
  estoqueMinimo: number
  custo: number
  precoVenda: number
  fornecedor: FornecedorResolvido | null
  /** Pedido em aberto que já leva este produto. */
  noPedido: string | null
  quantidadeSugerida: number
  solicitacoes: number
  temEncomenda: boolean
  /** Veio de falta/encomenda anotada pelo vendedor. */
  vendedor: boolean
  /** Está abaixo do estoque mínimo. */
  automatico: boolean
}

/**
 * Junta as faltas abertas (do vendedor) com os produtos abaixo do mínimo,
 * uma linha por produto. Falta sem produto no cadastro fica de fora: não dá
 * para pôr num pedido o que não existe no cadastro.
 */
export function montarLinhasCompra(
  faltas: FaltaAberta[],
  produtos: Map<string, ProdutoCompra>,
  fornecedorPorProduto: Map<string, FornecedorResolvido>,
  pedidoPorProduto: Map<string, string>,
): LinhaCompra[] {
  const porProduto = new Map<string, LinhaCompra>()

  const linha = (p: ProdutoCompra): LinhaCompra => {
    let l = porProduto.get(p.id)
    if (!l) {
      l = {
        produtoId: p.id, nome: p.nome, sku: p.sku, unidade: p.unidade ?? 'UN',
        estoque: Number(p.estoque ?? 0), estoqueMinimo: Number(p.estoque_minimo ?? 0),
        custo: Number(p.preco_custo ?? 0),
        precoVenda: Number(p.preco_venda ?? 0),
        fornecedor: fornecedorPorProduto.get(p.id) ?? null,
        noPedido: pedidoPorProduto.get(p.id) ?? null,
        quantidadeSugerida: 0, solicitacoes: 0, temEncomenda: false,
        vendedor: false, automatico: false,
      }
      porProduto.set(p.id, l)
    }
    return l
  }

  for (const f of faltas) {
    if (!f.produto_id || !PRECISA_COMPRAR.includes(f.status)) continue
    const p = produtos.get(f.produto_id)
    if (!p) continue
    const l = linha(p)
    l.vendedor = true
    l.solicitacoes++
    l.quantidadeSugerida += Math.max(1, Number(f.quantidade_solicitada ?? 1))
    if (f.tipo === 'encomenda') l.temEncomenda = true
  }

  for (const p of produtos.values()) {
    if (!abaixoDoMinimo(p.estoque, p.estoque_minimo)) continue
    const l = linha(p)
    l.automatico = true
    // Pedido do balcão e mínimo juntos: o maior dos dois cobre ambos.
    l.quantidadeSugerida = Math.max(l.quantidadeSugerida, sugestaoReposicao(p.estoque, p.estoque_minimo))
  }

  // Encomenda (gente esperando) → falta do balcão → só automático.
  const peso = (l: LinhaCompra) => (l.temEncomenda ? 0 : l.vendedor ? 1 : 2)
  return [...porProduto.values()].sort((a, b) =>
    peso(a) - peso(b) || b.solicitacoes - a.solicitacoes || a.nome.localeCompare(b.nome, 'pt-BR'))
}

// ── Carregamento (servidor) ─────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any

const LOTE = 200

/** Produtos ativos com mínimo cadastrado e estoque abaixo dele. */
export async function carregarAbaixoMinimo(sb: Sb, empresaId: string): Promise<(ProdutoCompra & { fornecedor_padrao_id: string | null })[]> {
  const todos: (ProdutoCompra & { fornecedor_padrao_id: string | null })[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from('produtos')
      .select('id, nome, sku, unidade, estoque, estoque_minimo, preco_custo, preco_venda, fornecedor_padrao_id')
      .eq('empresa_id', empresaId).eq('ativo', true).gt('estoque_minimo', 0)
      .order('id').range(de, de + 999)
    if (error || !data) break
    todos.push(...data)
    if (data.length < 1000) break
  }
  return todos.filter(p => abaixoDoMinimo(p.estoque, p.estoque_minimo))
}

/** Fornecedor resolvido e pedido em aberto de cada produto. */
export async function carregarContextoCompra(sb: Sb, empresaId: string, produtoIds: string[], padroes: Map<string, string | null>) {
  const ids = [...new Set(produtoIds)]
  const historico = new Map<string, HistoricoFornecedor[]>()
  const pedidoPorProduto = new Map<string, string>()

  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE)
    const [{ data: hist }, { data: itens }] = await Promise.all([
      sb.from('fornecedor_produto')
        .select('produto_id, fornecedor_id, ultima_compra_em, preferencial, custo_ultimo')
        .eq('empresa_id', empresaId).in('produto_id', lote),
      sb.from('pedidos_compra_itens')
        .select('produto_id, pedidos_compra!inner(numero, status, empresa_id)')
        .eq('pedidos_compra.empresa_id', empresaId)
        .not('pedidos_compra.status', 'in', '("cancelado","recebido")')
        .in('produto_id', lote),
    ])
    for (const h of hist ?? []) {
      historico.set(h.produto_id, [...(historico.get(h.produto_id) ?? []), h])
    }
    for (const it of itens ?? []) {
      const pc = Array.isArray(it.pedidos_compra) ? it.pedidos_compra[0] : it.pedidos_compra
      if (pc?.numero && !pedidoPorProduto.has(it.produto_id)) pedidoPorProduto.set(it.produto_id, String(pc.numero))
    }
  }

  const resolvidos = new Map<string, { id: string; origem: FornecedorResolvido['origem'] }>()
  for (const id of ids) {
    const r = resolverFornecedorId(padroes.get(id) ?? null, historico.get(id) ?? [])
    if (r) resolvidos.set(id, r)
  }

  const fornIds = [...new Set([...resolvidos.values()].map(r => r.id))]
  const nomes = new Map<string, string>()
  for (let i = 0; i < fornIds.length; i += LOTE) {
    const { data } = await sb.from('fornecedores').select('id, nome_fantasia, razao_social')
      .eq('empresa_id', empresaId).in('id', fornIds.slice(i, i + LOTE))
    for (const f of data ?? []) nomes.set(f.id, f.nome_fantasia || f.razao_social || 'Fornecedor')
  }

  const fornecedorPorProduto = new Map<string, FornecedorResolvido>()
  for (const [pid, r] of resolvidos) {
    const nome = nomes.get(r.id)
    if (nome) fornecedorPorProduto.set(pid, { id: r.id, nome, origem: r.origem })
  }
  return { fornecedorPorProduto, pedidoPorProduto }
}

/** A lista completa para o painel do pedido: faltas abertas + abaixo do mínimo. */
export async function carregarListaCompra(sb: Sb, empresaId: string): Promise<LinhaCompra[]> {
  const [{ data: faltas }, abaixo] = await Promise.all([
    sb.from('faltas').select('id, produto_id, quantidade_solicitada, status, tipo')
      .eq('empresa_id', empresaId).in('status', PRECISA_COMPRAR).not('produto_id', 'is', null).limit(2000),
    carregarAbaixoMinimo(sb, empresaId),
  ])
  const produtos = new Map<string, ProdutoCompra>(abaixo.map(p => [p.id, p]))
  const padroes = new Map<string, string | null>(abaixo.map(p => [p.id, p.fornecedor_padrao_id]))

  const faltam = [...new Set(((faltas ?? []) as FaltaAberta[]).map(f => f.produto_id!).filter(id => !produtos.has(id)))]
  for (let i = 0; i < faltam.length; i += LOTE) {
    const { data } = await sb.from('produtos')
      .select('id, nome, sku, unidade, estoque, estoque_minimo, preco_custo, preco_venda, fornecedor_padrao_id')
      .eq('empresa_id', empresaId).in('id', faltam.slice(i, i + LOTE))
    for (const p of data ?? []) { produtos.set(p.id, p); padroes.set(p.id, p.fornecedor_padrao_id) }
  }

  const ctx = await carregarContextoCompra(sb, empresaId, [...produtos.keys()], padroes)
  return montarLinhasCompra((faltas ?? []) as FaltaAberta[], produtos, ctx.fornecedorPorProduto, ctx.pedidoPorProduto)
}
