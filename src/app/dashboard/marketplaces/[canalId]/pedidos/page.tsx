import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PedidosMarketplaceClient from '@/components/marketplaces/PedidosMarketplaceClient'

export const dynamic = 'force-dynamic'

export default async function PedidosMarketplacePage({ params, searchParams }: {
  params: Promise<{ canalId: string }>
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const { canalId } = await params
  const { status = '', q = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: canal } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .single()

  if (!canal) notFound()

  let query = supabase
    .from('marketplace_pedidos')
    .select('*, marketplace_pedido_itens(*), marketplace_pedido_pacotes(*)')
    .eq('canal_id', canalId)
    .order('data_pedido', { ascending: false })

  if (status) query = query.eq('status', status)
  if (q) query = query.or(`cliente_nome.ilike.%${q}%,numero_pedido.ilike.%${q}%,id_externo.ilike.%${q}%`)

  const { data: pedidos } = await query.limit(200)

  return (
    <PedidosMarketplaceClient
      canal={canal}
      pedidos={pedidos ?? []}
      empresaId={empresaId}
      statusInicial={status}
      qInicial={q}
      operador={user?.email ?? ''}
    />
  )
}
