import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import RegrasPrecoClient from '@/components/marketplaces/RegrasPrecoClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function RegrasPrecoPage({ params }: {
  params: Promise<{ canalId: string }>
}) {
  const { canalId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: canal } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .single()

  if (!canal) notFound()

  const { data: regras } = await supabase
    .from('marketplace_regras_preco')
    .select('*')
    .eq('canal_id', canalId)
    .order('created_at', { ascending: false })

  const { data: depositos } = await supabase
    .from('depositos')
    .select('id, nome')
    .eq('empresa_id', empresaId)
    .order('nome')

  return (
    <RegrasPrecoClient
      canal={canal}
      regras={regras ?? []}
      depositos={depositos ?? []}
      empresaId={empresaId}
    />
  )
}
