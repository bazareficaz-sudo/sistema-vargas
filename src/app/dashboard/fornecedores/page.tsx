import { createClient } from '@/lib/supabase/server'
import FornecedoresClient from '@/components/fornecedores/FornecedoresClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function FornecedoresPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  let query = supabase
    .from('fornecedores')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('razao_social')

  if (q) query = query.or(`razao_social.ilike.%${q}%,nome_fantasia.ilike.%${q}%,cnpj.ilike.%${q}%`)

  const { data: fornecedores } = await query

  return <FornecedoresClient fornecedores={fornecedores ?? []} empresaId={empresaId} qInicial={q} />
}
