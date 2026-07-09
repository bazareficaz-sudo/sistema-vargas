import { createClient } from '@/lib/supabase/server'
import EstoqueBIClient from '@/components/relatorios/EstoqueBIClient'

export const dynamic = 'force-dynamic'

export default async function RelatorioEstoquePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  // Últimos 30 dias para calcular giro
  const inicio30 = new Date(); inicio30.setDate(inicio30.getDate() - 30); inicio30.setHours(0, 0, 0, 0)

  const [produtosRes, vendasIdsRes] = await Promise.all([
    supabase.from('produtos')
      .select('id, nome, sku, categoria, marca, estoque, estoque_minimo, preco_custo, preco_venda, ativo')
      .eq('empresa_id', empresaId)
      .eq('ativo', true),
    supabase.from('vendas').select('id')
      .eq('empresa_id', empresaId)
      .eq('status', 'concluida')
      .gte('created_at', inicio30.toISOString()),
  ])

  const produtos = produtosRes.data ?? []
  const vendaIds = (vendasIdsRes.data ?? []).map(v => v.id)

  // Itens vendidos últimos 30 dias
  const itensVendidos: Record<string, number> = {}
  if (vendaIds.length > 0) {
    const { data: itens } = await supabase
      .from('venda_itens').select('produto_id, quantidade').in('venda_id', vendaIds)
    for (const it of itens ?? []) {
      itensVendidos[it.produto_id] = (itensVendidos[it.produto_id] ?? 0) + Number(it.quantidade ?? 0)
    }
  }

  // Processa dados
  const lista = produtos.map(p => {
    const estoque = Number(p.estoque ?? 0)
    const custo = Number(p.preco_custo ?? 0)
    const vendido30 = itensVendidos[p.id] ?? 0
    const vendasDia = vendido30 / 30
    const diasCobertura = vendasDia > 0 ? Math.round(estoque / vendasDia) : null
    const capitalInvestido = estoque * custo
    const giro30 = estoque > 0 ? vendido30 / estoque : 0

    return {
      id: p.id, nome: p.nome, sku: p.sku ?? '', categoria: p.categoria ?? 'Sem categoria',
      estoque, estoqueMinimo: Number(p.estoque_minimo ?? 0),
      custo, preco: Number(p.preco_venda ?? 0),
      capitalInvestido, vendido30, diasCobertura, giro30,
    }
  })

  // KPIs
  const capitalTotal = lista.reduce((s, p) => s + p.capitalInvestido, 0)
  const semEstoque = lista.filter(p => p.estoque <= 0).length
  const abaixoMinimo = lista.filter(p => p.estoque < p.estoqueMinimo && p.estoqueMinimo > 0).length
  const semMovimento = lista.filter(p => p.vendido30 === 0).length
  const criticosCobertura = lista.filter(p => p.diasCobertura !== null && p.diasCobertura <= 7).length

  // Por categoria
  const porCategoria: Record<string, { capital: number; qtdProdutos: number; semEstoque: number }> = {}
  for (const p of lista) {
    if (!porCategoria[p.categoria]) porCategoria[p.categoria] = { capital: 0, qtdProdutos: 0, semEstoque: 0 }
    porCategoria[p.categoria].capital += p.capitalInvestido
    porCategoria[p.categoria].qtdProdutos++
    if (p.estoque <= 0) porCategoria[p.categoria].semEstoque++
  }
  const topCategorias = Object.entries(porCategoria)
    .map(([cat, v]) => ({ cat, ...v }))
    .sort((a, b) => b.capital - a.capital)
    .slice(0, 10)

  return (
    <EstoqueBIClient
      lista={lista}
      topCategorias={topCategorias}
      kpis={{ capitalTotal, semEstoque, abaixoMinimo, semMovimento, criticosCobertura, totalProdutos: lista.length }}
    />
  )
}
