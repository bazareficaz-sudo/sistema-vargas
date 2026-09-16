import type { Venda } from './calculos'

// Traduz as DUAS fontes de venda do sistema para o formato que o Monitor usa
// — o mesmo problema que `src/lib/pedidos/unificado.ts` já resolveu pro
// Centro de Pedidos: "vendas" (PDV/app, itens embutidos em JSONB) e
// "marketplace_pedidos" (Shopee/ML/Nuvemshop, itens em tabela própria) são
// dois conceitos de "pedido de um cliente" que não se conhecem.
//
// NÃO USAR os dois às cegas: `marketplace_pedidos.venda_id` existe
// precisamente porque um pedido de marketplace às vezes GANHA uma linha em
// `vendas` (o vínculo fiscal). Somar os dois sem filtrar conta a mesma venda
// duas vezes. A regra aqui: `marketplace_pedidos` é a fonte de verdade de
// venda de canal externo; uma linha de `vendas` com canal que não é PDV/APP
// (hoje só existe UM caso assim, herdado) é descartada, não somada.

type VendaBruta = {
  id: string
  cliente_nome: string | null
  vendedor_nome: string | null
  status: string
  total: number | string | null
  desconto_total: number | string | null
  canal: string | null
  terminal_id: string | null
  created_at: string
  itens: unknown
}

/** `null` quando a linha não é PDV/APP de verdade — ver cabeçalho do arquivo. */
export function vendaPdvParaVendaUnificada(v: VendaBruta): Venda | null {
  const canalBruto = (v.canal || 'PDV').toUpperCase()
  if (canalBruto !== 'PDV' && canalBruto !== 'APP') return null
  return {
    id: v.id,
    cliente_nome: v.cliente_nome,
    vendedor_nome: v.vendedor_nome,
    status: v.status,
    total: Number(v.total) || 0,
    desconto_total: Number(v.desconto_total) || 0,
    canal: canalBruto,
    canalNome: canalBruto,
    terminal_id: v.terminal_id,
    created_at: v.created_at,
    itens: Array.isArray(v.itens) ? (v.itens as Venda['itens']) : [],
  }
}

export type PedidoMarketplaceBruto = {
  id: string
  canal_id: string | null
  cliente_nome: string | null
  valor_total: number | string | null
  valor_desconto: number | string | null
  status: string
  data_pedido: string | null
  created_at: string
}

export type ItemPedidoMarketplaceBruto = {
  pedido_id: string
  produto_id: string | null
  nome_produto: string
  sku: string | null
  quantidade: number | string | null
  preco_unitario: number | string | null
  subtotal: number | string | null
}

/**
 * `itensPorPedido` já vem agrupado (ver `agruparItensPorPedido`), e
 * `nomePorCanal` de `marketplace_canais` — o mesmo par usado no Centro de
 * Pedidos, pra "Shopee Ouro"/"ML Eficaz" aparecerem com o nome de verdade em
 * vez do id do canal.
 */
export function pedidoMarketplaceParaVendaUnificada(
  pedido: PedidoMarketplaceBruto,
  itens: ItemPedidoMarketplaceBruto[],
  nomePorCanal: Map<string, string>,
): Venda {
  const canalNome = (pedido.canal_id && nomePorCanal.get(pedido.canal_id)) || 'Marketplace'
  return {
    id: pedido.id,
    cliente_nome: pedido.cliente_nome,
    vendedor_nome: null,
    status: pedido.status === 'cancelado' ? 'cancelado' : 'concluida',
    total: Number(pedido.valor_total) || 0,
    desconto_total: Number(pedido.valor_desconto) || 0,
    canal: 'Marketplace',
    canalNome,
    terminal_id: null,
    created_at: pedido.data_pedido ?? pedido.created_at,
    itens: itens.map(it => ({
      produto_id: it.produto_id,
      produto_nome: it.nome_produto,
      produto_sku: it.sku,
      quantidade: Number(it.quantidade) || 0,
      preco_unitario: Number(it.preco_unitario) || 0,
      subtotal: Number(it.subtotal) || 0,
    })),
  }
}

export function agruparItensPorPedido<T extends { pedido_id: string }>(itens: T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const it of itens) {
    const lista = mapa.get(it.pedido_id) ?? []
    lista.push(it)
    mapa.set(it.pedido_id, lista)
  }
  return mapa
}
