import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DepositosClient from '@/components/depositos/DepositosClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function DepositosPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: depositos } = await sb
    .from('depositos')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('principal', { ascending: false })
    .order('nome')

  return (
    <DepositosClient
      empresaId={empresaId}
      operador={user.email ?? ''}
      depositosIniciais={depositos ?? []}
    />
  )
}
