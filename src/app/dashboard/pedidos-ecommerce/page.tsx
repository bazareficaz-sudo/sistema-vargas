import { createClient } from '@/lib/supabase/server'
import PedidosEcommerceClient from '@/components/marketplaces/PedidosEcommerceClient'

export const dynamic = 'force-dynamic'

export default async function PedidosEcommercePage({ searchParams }: {
  searchParams: Promise<{ status?: string; q?: string; canalId?: string }>
}) {
  const { status = '', q = '', canalId = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: canais } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  let query = supabase
    .from('marketplace_pedidos')
    .select('*, marketplace_pedido_itens(*, produtos(nome, sku), marketplace_anuncios(imagens)), marketplace_pedido_pacotes(*), marketplace_canais(id, nome, plataforma)')
    .eq('empresa_id', empresaId)
    .order('data_pedido', { ascending: false })

  if (status) query = query.eq('status', status)
  if (canalId) query = query.eq('canal_id', canalId)
  if (q) query = query.or(`cliente_nome.ilike.%${q}%,numero_pedido.ilike.%${q}%,id_externo.ilike.%${q}%`)

  const { data: pedidos } = await query.limit(200)

  // Contagem real (sem o .limit acima) — o número exibido no cabeçalho não
  // pode depender do tamanho da página carregada, senão "sobe e desce"
  // conforme a base cresce além do limite, do jeito que confundiu antes.
  let countQuery = supabase
    .from('marketplace_pedidos')
    .select('*', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
  if (status) countQuery = countQuery.eq('status', status)
  if (canalId) countQuery = countQuery.eq('canal_id', canalId)
  if (q) countQuery = countQuery.or(`cliente_nome.ilike.%${q}%,numero_pedido.ilike.%${q}%,id_externo.ilike.%${q}%`)
  const { count: totalReal } = await countQuery

  return (
    <PedidosEcommerceClient
      canais={canais ?? []}
      pedidos={pedidos ?? []}
      totalReal={totalReal ?? (pedidos ?? []).length}
      empresaId={empresaId}
      statusInicial={status}
      qInicial={q}
      canalIdInicial={canalId}
      operador={user?.email ?? ''}
    />
  )
}
