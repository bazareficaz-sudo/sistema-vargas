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

  await vincularFaltas(supabase, pedidoData.empresa_id, id, pedidoData.status,
    (itens ?? []).map((i: Record<string, unknown>) => String(i.produto_id ?? '')).filter(Boolean))

  return NextResponse.json({ id })
}

// FALTAS ↔ PEDIDO.
//
// As faltas abertas dos produtos deste pedido passam a apontar para ele:
// "Na lista" enquanto o pedido não saiu (rascunho, cotação, aprovação) e
// "Pedido" depois de enviado. Produto que saiu do pedido — ou pedido
// cancelado — devolve a falta para "Pendente", para ela voltar à lista.
// Quem fecha a falta é a entrada da mercadoria (trigger no banco), não isto.
//
// Falha aqui não desfaz o pedido salvo: o vínculo é conveniência, o pedido
// é o que importa.
const ANTES_DE_ENVIAR = ['rascunho', 'em_cotacao', 'aguardando_aprovacao']
const FALTA_A_COMPRAR = ['pendente', 'em_analise', 'em_compra', 'pedido', 'notificado', 'comprado']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function vincularFaltas(sb: any, empresaId: string, pedidoId: string, status: string, produtoIds: string[]) {
  if (!empresaId || !pedidoId) return
  try {
    const cancelado = status === 'cancelado'
    let liberar = sb.from('faltas').update({ status: 'pendente', pedido_compra_id: null })
      .eq('empresa_id', empresaId).eq('pedido_compra_id', pedidoId).in('status', ['em_compra', 'pedido'])
    if (!cancelado && produtoIds.length > 0) liberar = liberar.not('produto_id', 'in', `(${produtoIds.join(',')})`)
    await liberar

    if (cancelado || produtoIds.length === 0 || !['enviado', ...ANTES_DE_ENVIAR].includes(status)) return
    await sb.from('faltas')
      .update({ status: ANTES_DE_ENVIAR.includes(status) ? 'em_compra' : 'pedido', pedido_compra_id: pedidoId })
      .eq('empresa_id', empresaId)
      .in('produto_id', produtoIds)
      .in('status', FALTA_A_COMPRAR)
      .or(`pedido_compra_id.is.null,pedido_compra_id.eq.${pedidoId}`)
  } catch (e) {
    console.error('[pedidos-compra/salvar] vínculo com faltas falhou', e)
  }
}
