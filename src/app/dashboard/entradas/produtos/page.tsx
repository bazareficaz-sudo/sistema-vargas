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

  // As mesmas compras entram por duas portas: lançamento manual (entrada_itens)
  // e nota importada por XML (nfe_itens). Esta tela só olhava a primeira — e o
  // nome dela é "Produtos Comprados", então metade das compras ficava invisível.
  //
  // Aqui as duas são lidas e normalizadas para o MESMO formato, para a tela não
  // precisar saber de onde cada linha veio. A coluna `origem` existe só para o
  // operador conseguir distinguir quando quiser.
  let qXml = supabase
    .from('nfe_itens')
    .select(`
      id, produto_id, produto_nome, produto_sku,
      quantidade_entrada, quantidade_xml,
      custo_anterior, custo_unitario, novo_preco, custo_total, created_at,
      nfe_entradas!inner(id, numero, serie, data_entrada, status, empresa_id, nome_fornecedor,
        fornecedores(id, razao_social, nome_fantasia))
    `)
    .eq('nfe_entradas.empresa_id', empresaId)
    .neq('nfe_entradas.status', 'cancelada')
    .order('created_at', { ascending: false })
    .limit(500)

  if (sp.produto) qXml = qXml.ilike('produto_nome', `%${sp.produto}%`)
  if (sp.de) qXml = qXml.gte('created_at', sp.de)
  if (sp.ate) qXml = qXml.lte('created_at', sp.ate + 'T23:59:59')

  const { data: itensXml } = await qXml

  const normalizados = (itensXml ?? []).map((i: any) => {
    const e = i.nfe_entradas ?? {}
    return {
      id: i.id,
      produto_id: i.produto_id,
      nome_produto: i.produto_nome,
      sku: i.produto_sku,
      // A quantidade que vale é a conferida na entrada; a do XML é o que o
      // fornecedor declarou, e nem sempre é o que chegou.
      quantidade: i.quantidade_entrada ?? i.quantidade_xml,
      preco_custo_anterior: i.custo_anterior,
      preco_custo_novo: i.custo_unitario,
      markup: null,
      preco_venda_novo: i.novo_preco,
      subtotal: i.custo_total,
      created_at: i.created_at,
      origem: 'xml',
      entradas: {
        id: e.id,
        numero_entrada: null,
        numero_nf: e.numero ? `${e.numero}${e.serie ? '-' + e.serie : ''}` : null,
        data_entrada: e.data_entrada,
        status: e.status,
        empresa_id: e.empresa_id,
        // Nota importada guarda o nome do fornecedor mesmo sem cadastro
        // vinculado — usar o desnormalizado evita linha órfã sem fornecedor.
        fornecedores: e.fornecedores ?? (e.nome_fornecedor ? { id: null, razao_social: e.nome_fornecedor, nome_fantasia: null } : null),
      },
    }
  })

  const todosItens = [
    ...(itens ?? []).map((i: any) => ({ ...i, origem: 'manual' })),
    ...normalizados,
  ].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))

  // Fornecedores para filtro
  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, razao_social, nome_fantasia')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('razao_social')

  // Filtra por fornecedor após join (supabase filtro em nested)
  const itensFiltrados = sp.fornecedor
    ? todosItens.filter((i: any) => {
        const e = i.entradas as any
        const f = e?.fornecedores
        if (!f) return false
        return (f.razao_social + (f.nome_fantasia ?? '')).toLowerCase().includes(sp.fornecedor!.toLowerCase())
      })
    : todosItens

  return (
    <ProdutosEntradasClient
      itens={itensFiltrados as any}
      fornecedores={fornecedores ?? []}
      filtrosIniciais={{ produto: sp.produto ?? '', fornecedor: sp.fornecedor ?? '', de: sp.de ?? '', ate: sp.ate ?? '' }}
    />
  )
}
