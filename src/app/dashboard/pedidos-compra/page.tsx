import { createClient } from '@/lib/supabase/server'
import PedidosCompraListClient from '@/components/pedidos-compra/PedidosCompraListClient'

export const dynamic = 'force-dynamic'

export default async function PedidosCompraPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: pedidos } = await supabase
    .from('pedidos_compra')
    .select('id, numero, status, data_pedido, previsao_entrega, total, subtotal, observacoes, created_at, fornecedor_id, fornecedores(nome_fantasia, razao_social)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(200)

  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, nome_fantasia, razao_social')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome_fantasia')

  // Conta itens por pedido
  const pedidoIds = (pedidos ?? []).map(p => p.id)
  let itensCount: Record<string, number> = {}
  if (pedidoIds.length > 0) {
    const { data: cnts } = await supabase
      .from('pedidos_compra_itens')
      .select('pedido_id')
      .in('pedido_id', pedidoIds)
    for (const row of cnts ?? []) {
      itensCount[row.pedido_id] = (itensCount[row.pedido_id] ?? 0) + 1
    }
  }

  const pedidosMapped = (pedidos ?? []).map(p => {
    const forn = Array.isArray(p.fornecedores) ? p.fornecedores[0] : p.fornecedores
    return {
      ...p,
      fornecedores: forn ? { nome_fantasia: forn.nome_fantasia ?? '', razao_social: forn.razao_social ?? '' } : null,
      qtdItens: itensCount[p.id] ?? 0,
    }
  })

  return (
    <PedidosCompraListClient
      pedidos={pedidosMapped}
      fornecedores={fornecedores ?? []}
      empresaId={empresaId}
    />
  )
}
