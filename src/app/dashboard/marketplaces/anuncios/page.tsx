import { createClient } from '@/lib/supabase/server'
import AnunciosLandingClient from '@/components/marketplaces/AnunciosLandingClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { PLATAFORMA_LOJA_ONLINE } from '@/lib/marketplace/canais'

export const dynamic = 'force-dynamic'

// Landing sem canal — o usuário escolhe a loja aqui e é levado direto pra
// tela de anúncios daquela loja (que já tem, ela mesma, um seletor de canal
// no topo pra trocar sem precisar voltar aqui).
export default async function AnunciosLandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: canais } = await supabase
    .from('marketplace_canais')
    .select('id, nome')
    // Loja Online não tem anúncio para listar — ver src/lib/marketplace/canais.ts.
    .neq('plataforma', PLATAFORMA_LOJA_ONLINE)
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  return <AnunciosLandingClient canais={canais ?? []} />
}
