import { createClient } from '@/lib/supabase/server'
import EtiquetaModelosClient from '@/components/etiquetas/EtiquetaModelosClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function EtiquetaModelosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: modelos } = await supabase
    .from('etiqueta_modelos')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })

  return (
    <EtiquetaModelosClient modelos={modelos ?? []} empresaId={empresaId} />
  )
}
