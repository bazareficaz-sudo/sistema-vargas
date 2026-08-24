import { createClient } from '@/lib/supabase/server'
import MarketplacesClient from '@/components/marketplaces/MarketplacesClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { PLATAFORMA_LOJA_ONLINE } from '@/lib/marketplace/canais'

export const dynamic = 'force-dynamic'

export default async function MarketplacesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: canais } = await supabase
    .from('marketplace_canais')
    .select('*')
    // A Loja Online também é um canal, mas não é um marketplace: não tem
    // OAuth, anúncio nem sincronização. Ela tem painel próprio em
    // /dashboard/loja-online. Ver src/lib/marketplace/canais.ts.
    .neq('plataforma', PLATAFORMA_LOJA_ONLINE)
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
