import { createClient } from '@/lib/supabase/server'
import ProdutosEntradasClient from '@/components/entradas/ProdutosEntradasClient'

export const dynamic = 'force-dynamic'

export default async function ProdutosEntradasPage({
  searchParams,
}: { searchParams: Promise<{ produto?: string; fornecedor?: string; de?: string; ate?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  // Busca histórico de compras via entrada_itens + entradas
  let query = supabase
    .from('entrada_itens')
    .select(`
      id,
      produto_id,
      nome_produto,
      sku,
      quantidade,
      preco_custo_anterior,
      preco_custo_novo,
      markup,
      preco_venda_novo,
      subtotal,
      created_at,
      entradas!inner(
        id,
        numero_entrada,
        numero_nf,
        data_entrada,
        status,
        empresa_id,
        fornecedores(id, razao_social, nome_fantasia)
      )
    `)
    .eq('entradas.empresa_id', empresaId)
    .neq('entradas.status', 'cancelada')
    .order('created_at', { ascending: false })
    .limit(500)

  if (sp.produto) query = query.ilike('nome_produto', `%${sp.produto}%`)
  if (sp.de) query = query.gte('created_at', sp.de)
  if (sp.ate) query = query.lte('created_at', sp.ate + 'T23:59:59')

  const { data: itens } = await query

  // Fornecedores para filtro
  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, razao_social, nome_fantasia')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('razao_social')

  // Filtra por fornecedor após join (supabase filtro em nested)
  const itensFiltrados = sp.fornecedor
    ? (itens ?? []).filter(i => {
        const e = i.entradas as any
        const f = e?.fornecedores
        if (!f) return false
        return (f.razao_social + (f.nome_fantasia ?? '')).toLowerCase().includes(sp.fornecedor!.toLowerCase())
      })
    : (itens ?? [])

  return (
    <ProdutosEntradasClient
      itens={itensFiltrados as any}
      fornecedores={fornecedores ?? []}
      filtrosIniciais={{ produto: sp.produto ?? '', fornecedor: sp.fornecedor ?? '', de: sp.de ?? '', ate: sp.ate ?? '' }}
    />
  )
}
