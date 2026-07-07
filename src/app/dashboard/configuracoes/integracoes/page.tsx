import { createClient } from '@/lib/supabase/server'
import IntegracoesClient from '@/components/configuracoes/IntegracoesClient'

export const dynamic = 'force-dynamic'

export default async function IntegracoesPage() {
  const sb = await createClient()
  const { data: integracoes } = await sb
    .from('sistema_integracoes')
    .select('*')
    .order('plataforma')

  return <IntegracoesClient integracoes={integracoes ?? []} />
}
