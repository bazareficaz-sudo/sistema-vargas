import { createClient } from '@/lib/supabase/server'
import EtiquetaModelosClient from '@/components/etiquetas/EtiquetaModelosClient'

export const dynamic = 'force-dynamic'

export default async function EtiquetaModelosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
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
