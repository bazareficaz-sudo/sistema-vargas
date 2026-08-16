import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import EditarEntradaClient from '@/components/entradas/EditarEntradaClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function EntradaDetalhePage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, role')
  const empresaId = profile?.empresa_id ?? ''
  const operadorNome = user?.email ?? ''

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

  // Busca preços atuais dos produtos vinculados
  const produtoIds = (itens ?? []).filter(i => i.produto_id).map(i => i.produto_id as string)
  let produtosMap: Record<string, { preco_venda: number; preco_custo: number; categoria: string | null; marca: string | null; tipo: string }> = {}
  if (produtoIds.length > 0) {
    const { data: prods } = await supabase
      .from('produtos')
      .select('id, preco_venda, preco_custo, categoria, marca, tipo')
      .in('id', produtoIds)
    for (const p of prods ?? []) {
      produtosMap[p.id] = { preco_venda: p.preco_venda, preco_custo: p.preco_custo, categoria: p.categoria, marca: p.marca, tipo: p.tipo }
    }
  }

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

  // Histórico de preços desta entrada
  const { data: historicoPrecos } = await supabase
    .from('historico_precos')
    .select('*')
    .eq('entrada_id', id)
    .order('created_at', { ascending: false })

  return (
    <EditarEntradaClient
      entrada={entrada}
      itens={itens ?? []}
      contasPagar={contasPagar ?? []}
      fornecedores={fornecedores ?? []}
      produtosMap={produtosMap}
      historicoPrecos={historicoPrecos ?? []}
      empresaId={empresaId}
      operadorNome={operadorNome}
    />
  )
}
