import { createClient } from '@/lib/supabase/server'
import MarketplacesClient from '@/components/marketplaces/MarketplacesClient'

export const dynamic = 'force-dynamic'

export default async function MarketplacesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: canais } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  // Totais por canal
  const { data: anunciosTotais } = await supabase
    .from('marketplace_anuncios')
    .select('canal_id, status')
    .eq('empresa_id', empresaId)

  const { data: pedidosTotais } = await supabase
    .from('marketplace_pedidos')
    .select('canal_id, status, valor_total')
    .eq('empresa_id', empresaId)

  return (
    <MarketplacesClient
      canais={canais ?? []}
      anunciosTotais={anunciosTotais ?? []}
      pedidosTotais={pedidosTotais ?? []}
      empresaId={empresaId}
    />
  )
  // sucesso=shopee|mercadolivre|erro=... são lidos pelo client via useSearchParams
}
