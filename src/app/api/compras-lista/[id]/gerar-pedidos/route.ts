import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Transforma a lista em pedido — um pedido POR FORNECEDOR.
//
// A lista pode ter produtos de vários fornecedores misturados; um pedido
// de compra é sempre de um só. Esta rota agrupa e cria um rascunho por
// fornecedor, sempre em status "rascunho" — nunca "enviado". O comprador
// ainda revisa cada um em Pedidos de Compra antes de mandar para o
// fornecedor de verdade. Isso não é burocracia a mais: é o item 26 do
// desenho original — "nunca obrigar o comprador a aceitar a recomendação".
//
// Item sem fornecedor não entra em pedido nenhum — fica na lista,
// esperando o comprador escolher.

type Corpo = { itemIds?: string[] }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listaId } = await params
  const { itemIds } = await req.json() as Corpo

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: lista } = await sb.from('compras_listas').select('id, status').eq('id', listaId).eq('empresa_id', empresaId).maybeSingle()
  if (!lista) return NextResponse.json({ ok: false, erro: 'Lista não encontrada.' }, { status: 404 })

  let query = sb.from('compras_lista_itens')
    .select('id, produto_id, quantidade, fornecedor_id, custo_unitario_estimado, observacao')
    .eq('lista_id', listaId).is('pedido_compra_id', null)
  if (Array.isArray(itemIds) && itemIds.length > 0) query = query.in('id', itemIds)
  const { data: itens } = await query

  if (!itens || itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum item pendente para gerar pedido.' }, { status: 400 })
  }

  const semFornecedor = itens.filter(i => !i.fornecedor_id)
  const comFornecedor = itens.filter(i => i.fornecedor_id)

  const porFornecedor = new Map<string, typeof itens>()
  for (const it of comFornecedor) {
    const arr = porFornecedor.get(it.fornecedor_id!) ?? []
    arr.push(it)
    porFornecedor.set(it.fornecedor_id!, arr)
  }

  const pedidosCriados: { pedidoId: string; fornecedorId: string; itens: number; total: number }[] = []

  for (const [fornecedorId, itensDoFornecedor] of porFornecedor) {
    const total = itensDoFornecedor.reduce((s, i) => s + Number(i.quantidade) * Number(i.custo_unitario_estimado ?? 0), 0)

    const { data: pedido, error: erroPedido } = await sb.from('pedidos_compra').insert({
      empresa_id: empresaId, fornecedor_id: fornecedorId, status: 'rascunho',
      data_pedido: new Date().toISOString().slice(0, 10),
      comprador_id: user.id, origem: 'auxiliar',
      subtotal: total, total,
    }).select('id').single()

    if (erroPedido || !pedido) continue

    const { error: erroItens } = await sb.from('pedidos_compra_itens').insert(
      itensDoFornecedor.map(i => ({
        pedido_id: pedido.id, produto_id: i.produto_id, quantidade: i.quantidade,
        custo_unitario: i.custo_unitario_estimado ?? 0,
        total: Number(i.quantidade) * Number(i.custo_unitario_estimado ?? 0),
        observacao: i.observacao,
      })),
    )
    if (erroItens) { await sb.from('pedidos_compra').delete().eq('id', pedido.id); continue }

    await sb.from('compras_lista_itens')
      .update({ pedido_compra_id: pedido.id })
      .in('id', itensDoFornecedor.map(i => i.id))

    pedidosCriados.push({ pedidoId: pedido.id, fornecedorId, itens: itensDoFornecedor.length, total })
  }

  // Lista some sozinha quando esvazia — deixa de "aberta" pra não confundir
  // com uma bancada que ainda tem trabalho.
  const { count: restantes } = await sb.from('compras_lista_itens')
    .select('id', { count: 'exact', head: true }).eq('lista_id', listaId).is('pedido_compra_id', null)
  if ((restantes ?? 0) === 0) {
    await sb.from('compras_listas').update({ status: 'finalizada', updated_at: new Date().toISOString() }).eq('id', listaId)
  }

  return NextResponse.json({
    ok: true,
    pedidos: pedidosCriados,
    semFornecedor: semFornecedor.length,
  })
}
