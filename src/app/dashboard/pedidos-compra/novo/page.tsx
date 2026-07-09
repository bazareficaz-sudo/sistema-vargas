import { createClient } from '@/lib/supabase/server'
import NovoPedidoClient from '@/components/pedidos-compra/NovoPedidoClient'

export const dynamic = 'force-dynamic'

export default async function NovoPedidoPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, nome_fantasia, razao_social, email, telefone')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome_fantasia')

  let pedidoExistente = null
  let itensExistentes: unknown[] = []

  if (id) {
    const { data: ped } = await supabase
      .from('pedidos_compra')
      .select('*')
      .eq('id', id)
      .eq('empresa_id', empresaId)
      .single()
    pedidoExistente = ped

    const { data: itens } = await supabase
      .from('pedidos_compra_itens')
      .select('*, produtos(nome, sku, unidade, preco_venda)')
      .eq('pedido_id', id)
    itensExistentes = itens ?? []
  }

  return (
    <NovoPedidoClient
      fornecedores={fornecedores ?? []}
      empresaId={empresaId}
      userId={user!.id}
      pedidoExistente={pedidoExistente}
      itensExistentes={itensExistentes}
    />
  )
}
