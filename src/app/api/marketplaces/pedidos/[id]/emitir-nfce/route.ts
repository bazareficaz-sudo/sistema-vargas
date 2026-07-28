import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { garantirVendaDoPedido } from '@/lib/fiscal/pedidoParaVenda'
import { emitirNfceParaVenda } from '@/lib/fiscal/emitirParaVenda'

// Rota fina: garante a venda do pedido (cria na primeira vez, reaproveita
// depois) e chama a mesma emitirNfceParaVenda() usada por PDV/Vendas/
// Automações — sem duplicar nenhuma lógica fiscal.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: pedidoId } = await params

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: pedido } = await sb.from('marketplace_pedidos').select('id').eq('id', pedidoId).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido) return NextResponse.json({ ok: false, erro: 'Pedido não encontrado' }, { status: 404 })

  const garantia = await garantirVendaDoPedido(sb, pedidoId, empresaId)
  if (!garantia.ok) return NextResponse.json({ ok: false, erro: garantia.erro }, { status: 400 })

  const resultado = await emitirNfceParaVenda(sb, empresaId, garantia.vendaId, user.email)
  return NextResponse.json(resultado, { status: resultado.ok || resultado.jaEmitida ? 200 : 400 })
}
