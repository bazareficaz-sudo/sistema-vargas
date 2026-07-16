import { createClient } from '@/lib/supabase/server'
import AnunciosLandingClient from '@/components/marketplaces/AnunciosLandingClient'

export const dynamic = 'force-dynamic'

// Landing sem canal — o usuário escolhe a loja aqui e é levado direto pra
// tela de anúncios daquela loja (que já tem, ela mesma, um seletor de canal
// no topo pra trocar sem precisar voltar aqui).
export default async function AnunciosLandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: canais } = await supabase
    .from('marketplace_canais')
    .select('id, nome')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  return <AnunciosLandingClient canais={canais ?? []} />
}
