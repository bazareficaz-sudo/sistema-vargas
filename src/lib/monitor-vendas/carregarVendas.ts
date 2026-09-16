import { buscarTudo } from '@/lib/supabase/paginar'
import {
  vendaPdvParaVendaUnificada, pedidoMarketplaceParaVendaUnificada, agruparItensPorPedido,
  type PedidoMarketplaceBruto, type ItemPedidoMarketplaceBruto,
} from './unificarVendas'
import type { Venda } from './calculos'

// Um carregador só, usado tanto pelo `page.tsx` (primeira carga, no servidor)
// quanto pelo auto-refresh do cliente — as duas fontes (`vendas` e
// `marketplace_pedidos`) e a regra de deduplicação entre elas não podem
// divergir entre os dois lugares, senão o servidor mostra uma coisa e o
// refresh mostra outra 60 segundos depois.
//
// `sb` é o client do supabase-js, de qualquer um dos dois lados — as duas
// implementações (server e browser) respondem à mesma interface.
export async function carregarVendasUnificadas(sb: any, empresaId: string, limite: number): Promise<Venda[]> {
  const [vendasBrutas, canaisRes] = await Promise.all([
    buscarTudo<any>(
      (de, ate) => sb.from('vendas')
        .select('id, cliente_nome, vendedor_nome, status, total, desconto_total, canal, terminal_id, created_at, itens')
        .eq('empresa_id', empresaId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(de, ate),
      { teto: limite, rotulo: 'monitor-vendas/vendas' },
    ),
    sb.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', empresaId),
  ])

  const nomePorCanal = new Map<string, string>((canaisRes.data ?? []).map((c: any) => [c.id, c.nome]))

  const pedidosBrutos = await buscarTudo<PedidoMarketplaceBruto>(
    (de, ate) => sb.from('marketplace_pedidos')
      .select('id, canal_id, cliente_nome, valor_total, valor_desconto, status, data_pedido, created_at')
      .eq('empresa_id', empresaId)
      .neq('status', 'cancelado')
      .order('data_pedido', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(de, ate),
    { teto: limite, rotulo: 'monitor-vendas/marketplace_pedidos' },
  )

  // Em lotes de 200 ids: um `.in()` só, com todos os pedidos do período,
  // vira uma URL de dezenas de kilobytes — o mesmo problema que já mordeu o
  // ranking de produtos em outro relatório (ver CONTINUIDADE.md).
  const pedidoIds = pedidosBrutos.map(p => p.id)
  const itensBrutos: ItemPedidoMarketplaceBruto[] = []
  for (let i = 0; i < pedidoIds.length; i += 200) {
    const lote = pedidoIds.slice(i, i + 200)
    const dados = await buscarTudo<ItemPedidoMarketplaceBruto>(
      (de, ate) => sb.from('marketplace_pedido_itens')
        .select('pedido_id, produto_id, nome_produto, sku, quantidade, preco_unitario, subtotal')
        .in('pedido_id', lote)
        .order('id', { ascending: true })
        .range(de, ate),
      { rotulo: 'monitor-vendas/marketplace_pedido_itens' },
    )
    itensBrutos.push(...dados)
  }
  const itensPorPedido = agruparItensPorPedido(itensBrutos)

  const vendasPdv = vendasBrutas
    .map(vendaPdvParaVendaUnificada)
    .filter((v): v is Venda => v !== null)
  const vendasMkt = pedidosBrutos.map(p =>
    pedidoMarketplaceParaVendaUnificada(p, itensPorPedido.get(p.id) ?? [], nomePorCanal))

  return [...vendasPdv, ...vendasMkt].sort((a, b) => b.created_at.localeCompare(a.created_at))
}
