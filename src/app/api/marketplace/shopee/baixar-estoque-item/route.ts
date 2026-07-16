import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { baixarEstoquePedidoItem } from '@/lib/produtos/estoque'

// Dispara a baixa atômica de um item de pedido — usado depois de um
// mapeamento manual feito na hora, direto do painel de detalhe do pedido
// (a baixa automática na importação já roda dentro de processRawOrder no
// servidor; esta rota cobre o caso de mapear DEPOIS que o pedido já chegou).
export async function POST(req: Request) {
  const { pedidoItemId } = await req.json()
  if (!pedidoItemId) return NextResponse.json({ ok: false, erro: 'pedidoItemId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  // Confirma que o item pertence a um pedido da empresa do usuário logado
  // antes de baixar estoque — nunca confiar só no filtro do frontend.
  const { data: item } = await sb
    .from('marketplace_pedido_itens')
    .select('id, marketplace_pedidos!inner(empresa_id)')
    .eq('id', pedidoItemId)
    .eq('marketplace_pedidos.empresa_id', empresaId)
    .maybeSingle()
  if (!item) return NextResponse.json({ ok: false, erro: 'Item não encontrado' }, { status: 404 })

  const resultado = await baixarEstoquePedidoItem(sb, pedidoItemId)
  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.motivo }, { status: 400 })
  return NextResponse.json({ ok: true, jaProcessado: !!resultado.jaProcessado })
}
