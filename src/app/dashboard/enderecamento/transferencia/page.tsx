import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import TransferenciaInternaClient from '@/components/enderecamento/TransferenciaInternaClient'

export const dynamic = 'force-dynamic'

export default async function TransferenciaInternaPage({ searchParams }: { searchParams: Promise<{ depositoId?: string }> }) {
  const { depositoId } = await searchParams
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: depositos } = await sb.from('depositos')
    .select('id, nome, principal').eq('empresa_id', empresaId).eq('ativo', true).order('nome')

  return <TransferenciaInternaClient depositos={depositos ?? []} depositoIdInicial={depositoId ?? ''} />
}
