import { createClient } from '@/lib/supabase/server'
import NovaEntradaClient from '@/components/entradas/NovaEntradaClient'

export const dynamic = 'force-dynamic'

export default async function NovaEntradaPage({
  searchParams,
}: {
  searchParams: Promise<{ rascunho?: string }>
}) {
  const { rascunho } = await searchParams
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

  let rascunhoInicial: { id: string; entrada: any; itens: any[] } | undefined
  if (rascunho) {
    const { data: entrada } = await supabase
      .from('entradas')
      .select('*')
      .eq('id', rascunho)
      .eq('empresa_id', empresaId)
      .eq('status', 'rascunho')
      .single()
    if (entrada) {
      const { data: itens } = await supabase
        .from('entrada_itens')
        .select('*')
        .eq('entrada_id', rascunho)
        .order('created_at')
      rascunhoInicial = { id: rascunho, entrada, itens: itens ?? [] }
    }
  }

  return (
    <NovaEntradaClient
      fornecedores={fornecedores ?? []}
      empresaId={empresaId}
      rascunhoInicial={rascunhoInicial}
    />
  )
}
