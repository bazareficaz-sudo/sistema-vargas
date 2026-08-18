import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import EnderecamentoDashboardClient from '@/components/enderecamento/EnderecamentoDashboardClient'

export const dynamic = 'force-dynamic'

export default async function EnderecamentoPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: depositos } = await sb.from('depositos')
    .select('id, nome, principal').eq('empresa_id', empresaId).eq('ativo', true).order('nome')

  return <EnderecamentoDashboardClient depositos={depositos ?? []} />
}
