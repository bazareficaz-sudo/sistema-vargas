import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import DetalhePedidoClient from '@/components/pedidos/DetalhePedidoClient'

export const dynamic = 'force-dynamic'

// Ficha do pedido, com as duas origens caindo no mesmo formato.
//
// A tela de Pedidos unifica a LISTA; esta unifica o DETALHE. Antes, "abrir"
// jogava o operador em telas diferentes conforme a origem, e ele precisava
// aprender dois layouts para a mesma tarefa.

export default async function DetalhePedidoPage({ params }: {
  params: Promise<{ fonte: string; id: string }>
}) {
  const { fonte, id } = await params
  if (fonte !== 'venda' && fonte !== 'marketplace') notFound()

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'realizar_vendas')
  if (!guarda.ok) {
    return (
      <div className="p-8">
        <div className="max-w-md bg-white border border-gray-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-gray-900">Sem acesso</h1>
          <p className="text-sm text-gray-500 mt-1">Você não tem permissão para ver pedidos.</p>
        </div>
      </div>
    )
  }

  if (fonte === 'venda') {
    const { data: venda } = await sb.from('vendas')
      .select('*, clientes(nome, telefone, email, cpf_cnpj)')
      .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
    if (!venda) notFound()

    const { data: itens } = await sb.from('venda_itens')
      .select('*').eq('venda_id', id).order('created_at')

    return <DetalhePedidoClient fonte="venda" pedido={venda} itens={itens ?? []} canal={null} />
  }

  const { data: pedido } = await sb.from('marketplace_pedidos')
    .select('*').eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!pedido) notFound()

  const [itensRes, canalRes] = await Promise.all([
    sb.from('marketplace_pedido_itens').select('*').eq('pedido_id', id),
    sb.from('marketplace_canais').select('id, nome, plataforma').eq('id', pedido.canal_id).maybeSingle(),
  ])

  return <DetalhePedidoClient fonte="marketplace" pedido={pedido} itens={itensRes.data ?? []} canal={canalRes.data ?? null} />
}
