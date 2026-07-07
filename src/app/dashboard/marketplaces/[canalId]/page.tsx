import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import CanalConfigClient from '@/components/marketplaces/CanalConfigClient'

export const dynamic = 'force-dynamic'

export default async function CanalConfigPage({ params }: { params: Promise<{ canalId: string }> }) {
  const { canalId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: canal } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .single()

  if (!canal) notFound()

  const { data: logs } = await supabase
    .from('marketplace_sync_log')
    .select('*')
    .eq('canal_id', canalId)
    .order('created_at', { ascending: false })
    .limit(20)

  return <CanalConfigClient canal={canal} logs={logs ?? []} empresaId={empresaId} />
}
