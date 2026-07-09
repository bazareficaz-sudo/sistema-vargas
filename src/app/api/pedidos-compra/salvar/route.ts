import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { pedido, itens } = body

  const pedidoData = {
    empresa_id: pedido.empresa_id,
    fornecedor_id: pedido.fornecedor_id || null,
    status: pedido.status ?? 'rascunho',
    data_pedido: pedido.data_pedido,
    previsao_entrega: pedido.previsao_entrega || null,
    condicao_pagamento: pedido.condicao_pagamento || null,
    comprador_id: user.id,
    observacoes: pedido.observacoes || null,
    subtotal: pedido.subtotal ?? 0,
    desconto_geral: pedido.desconto_geral ?? 0,
    frete: pedido.frete ?? 0,
    outras_despesas: pedido.outras_despesas ?? 0,
    total: pedido.total ?? 0,
    updated_at: new Date().toISOString(),
  }

  let id = pedido.id
  if (!id) {
    const { data, error } = await supabase.from('pedidos_compra').insert(pedidoData).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    id = data.id
  } else {
    const { error } = await supabase.from('pedidos_compra').update(pedidoData).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Salva itens
  await supabase.from('pedidos_compra_itens').delete().eq('pedido_id', id)
  if (itens?.length > 0) {
    const { error } = await supabase.from('pedidos_compra_itens').insert(
      itens.map((i: Record<string, unknown>) => ({
        pedido_id: id,
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        custo_unitario: i.custo_unitario,
        desconto: i.desconto ?? 0,
        total: i.total,
        ultimo_custo_ref: i.ultimoCusto ?? null,
        custo_medio_ref: i.custoMedio ?? null,
        observacao: i.observacao || null,
      }))
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id })
}
