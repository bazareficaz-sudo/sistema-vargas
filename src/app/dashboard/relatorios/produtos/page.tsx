import { createClient } from '@/lib/supabase/server'
import ProdutosBIClient from '@/components/relatorios/ProdutosBIClient'

export const dynamic = 'force-dynamic'

export default async function RelatorioProdutosPage({
  searchParams,
}: { searchParams: Promise<{ inicio?: string; fim?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicio = sp.inicio ?? new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
  const fim = sp.fim ?? hoje.toISOString().slice(0, 10)

  // Vendas concluídas do período para pegar os IDs
  const { data: vendasIds } = await supabase
    .from('vendas').select('id')
    .eq('empresa_id', empresaId)
    .eq('status', 'concluida')
    .gte('created_at', `${inicio}T00:00:00`)
    .lte('created_at', `${fim}T23:59:59`)

  const ids = (vendasIds ?? []).map(v => v.id)

  const [itensRes, produtosRes] = await Promise.all([
    ids.length > 0
      ? supabase.from('venda_itens')
          .select('produto_id, quantidade, preco_unitario, custo_unitario')
          .in('venda_id', ids)
      : Promise.resolve({ data: [] }),
    supabase.from('produtos')
      .select('id, nome, sku, categoria, marca, estoque, estoque_minimo, preco_custo, preco_venda, ativo')
      .eq('empresa_id', empresaId),
  ])

  const itens = itensRes.data ?? []
  const produtos = produtosRes.data ?? []

  // Mapa produto_id -> dados
  const prodMap: Record<string, any> = {}
  for (const p of produtos) prodMap[p.id] = p

  // Agrega por produto
  const agg: Record<string, { nome: string; sku: string; categoria: string; quantidade: number; faturamento: number; lucro: number }> = {}
  for (const it of itens) {
    const p = prodMap[it.produto_id]
    if (!p) continue
    if (!agg[it.produto_id]) agg[it.produto_id] = {
      nome: p.nome, sku: p.sku ?? '', categoria: p.categoria ?? 'Sem categoria',
      quantidade: 0, faturamento: 0, lucro: 0,
    }
    const fat = Number(it.preco_unitario ?? 0) * Number(it.quantidade ?? 0)
    const custo = Number(it.custo_unitario ?? p.preco_custo ?? 0) * Number(it.quantidade ?? 0)
    agg[it.produto_id].quantidade += Number(it.quantidade ?? 0)
    agg[it.produto_id].faturamento += fat
    agg[it.produto_id].lucro += fat - custo
  }

  // Curva ABC por faturamento
  const lista = Object.entries(agg)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.faturamento - a.faturamento)
  const totalFat = lista.reduce((s, p) => s + p.faturamento, 0)
  let acum = 0
  const curvaABC = lista.map(p => {
    acum += p.faturamento
    const pctAcum = totalFat ? (acum / totalFat) * 100 : 0
    const classe: 'A' | 'B' | 'C' = pctAcum <= 80 ? 'A' : pctAcum <= 95 ? 'B' : 'C'
    return { ...p, pctAcum, classe }
  })

  // Produtos sem venda no período
  const comVenda = new Set(Object.keys(agg))
  const semVenda = produtos.filter(p => p.ativo && !comVenda.has(p.id))

  // Produtos abaixo do mínimo
  const abaixoMinimo = produtos.filter(p => p.ativo && Number(p.estoque ?? 0) < Number(p.estoque_minimo ?? 0))

  const resumo = {
    totalProdutos: produtos.filter(p => p.ativo).length,
    totalComVenda: comVenda.size,
    totalSemVenda: semVenda.length,
    abaixoMinimo: abaixoMinimo.length,
    classeA: curvaABC.filter(p => p.classe === 'A').length,
    classeB: curvaABC.filter(p => p.classe === 'B').length,
    classeC: curvaABC.filter(p => p.classe === 'C').length,
  }

  return (
    <ProdutosBIClient
      curvaABC={curvaABC}
      semVenda={semVenda.slice(0, 50).map(p => ({ id: p.id, nome: p.nome, sku: p.sku ?? '', estoque: Number(p.estoque ?? 0), categoria: p.categoria ?? '' }))}
      abaixoMinimo={abaixoMinimo.slice(0, 50).map(p => ({ id: p.id, nome: p.nome, estoque: Number(p.estoque ?? 0), minimo: Number(p.estoque_minimo ?? 0) }))}
      resumo={resumo}
      filtros={{ inicio, fim }}
    />
  )
}
