import { createClient } from '@/lib/supabase/server'
import AutomacoesClient from '@/components/automacoes/AutomacoesClient'

export default async function AutomacoesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: automacoes }, { data: canais }] = await Promise.all([
    supabase.from('automacoes').select('*').eq('empresa_id', empresaId).order('created_at', { ascending: false }),
    supabase.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', empresaId).eq('ativo', true),
  ])

  return (
    <AutomacoesClient
      empresaId={empresaId}
      automacoesIniciais={automacoes ?? []}
      canais={canais ?? []}
    />
  )
}
