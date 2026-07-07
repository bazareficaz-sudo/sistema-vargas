import { createClient } from '@/lib/supabase/server'
import NovaEntradaClient from '@/components/entradas/NovaEntradaClient'

export const dynamic = 'force-dynamic'

export default async function NovaEntradaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, razao_social, nome_fantasia')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('razao_social')

  return <NovaEntradaClient fornecedores={fornecedores ?? []} empresaId={empresaId} />
}
