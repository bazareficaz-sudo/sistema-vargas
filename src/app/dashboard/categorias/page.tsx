import { createClient } from '@/lib/supabase/server'
import CategoriasClient from '@/components/CategoriasClient'

export default async function CategoriasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: categorias } = await supabase
    .from('categorias')
    .select('id, nome, pai_id, ativo, created_at')
    .eq('empresa_id', empresaId)
    .order('nome')

  return <CategoriasClient categorias={categorias ?? []} empresaId={empresaId} />
}
