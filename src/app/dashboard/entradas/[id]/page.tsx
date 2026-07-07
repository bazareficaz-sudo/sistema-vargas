import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import EditarEntradaClient from '@/components/entradas/EditarEntradaClient'

export const dynamic = 'force-dynamic'

export default async function EntradaDetalhePage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: entrada } = await supabase
    .from('entradas')
    .select('*, fornecedores(id, razao_social, nome_fantasia)')
    .eq('id', id)
    .eq('empresa_id', empresaId)
    .single()

  if (!entrada) notFound()

  const { data: itens } = await supabase
    .from('entrada_itens')
    .select('*')
    .eq('entrada_id', id)
    .order('created_at', { ascending: true })

  const { data: contasPagar } = await supabase
    .from('contas_pagar')
    .select('*')
    .eq('entrada_id', id)
    .order('parcela', { ascending: true })

  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, razao_social, nome_fantasia')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('razao_social')

  return (
    <EditarEntradaClient
      entrada={entrada}
      itens={itens ?? []}
      contasPagar={contasPagar ?? []}
      fornecedores={fornecedores ?? []}
      empresaId={empresaId}
    />
  )
}
