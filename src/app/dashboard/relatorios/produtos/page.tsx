import { createClient } from '@/lib/supabase/server'
import ProdutosBIClient from '@/components/relatorios/ProdutosBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { buscarTudo } from '@/lib/supabase/paginar'

export const dynamic = 'force-dynamic'

/** AAAA-MM-DD do dia seguinte, para usar como fim exclusivo de periodo. */
function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

type ProdutoRelatorio = {
  id: string; nome: string; sku: string | null; categoria: string | null; marca: string | null
  estoque: number | null; estoque_minimo: number | null
  preco_custo: number | null; preco_venda: number | null; ativo: boolean
}

export default async function RelatorioProdutosPage({
  searchParams,
}: { searchParams: Promise<{ inicio?: string; fim?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicio = sp.inicio ?? new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
  const fim = sp.fim ?? hoje.toISOString().slice(0, 10)

  // Faturamento e lucro por produto, agrupados no banco. O caminho antigo
  // pegava os ids das vendas do periodo (truncados em 1.000 pelo PostgREST) e
  // os mandava num `.in('venda_id', [...])` — com 2.016 vendas isso e uma URL
  // de dezenas de kilobytes, que nem chega a ser respondida.
  const [vendidosRes, produtos] = await Promise.all([
    supabase.rpc('produtos_vendidos', {
      p_empresa: empresaId,
      p_inicio: `${inicio}T00:00:00-03:00`,
      // Fim EXCLUSIVO: o dia seguinte às 00:00. "23:59:59" perde a venda
      // registrada no último segundo do dia — raro, mas é erro silencioso, e
      // esta tela existe para ser conferida.
      p_fim: `${diaSeguinte(fim)}T00:00:00-03:00`,
    }),
    buscarTudo<ProdutoRelatorio>(
      (de, ate) => supabase.from('produtos')
        .select('id, nome, sku, categoria, marca, estoque, estoque_minimo, preco_custo, preco_venda, ativo')
        .eq('empresa_id', empresaId).order('id').range(de, ate),
      { rotulo: 'produtos (curva ABC)' },
    ),
  ])

  const vendidos = (vendidosRes.data ?? []) as { produto_id: string; quantidade: number; faturamento: number; lucro: number }[]

  // Mapa produto_id -> dados
  const prodMap: Record<string, any> = {}
  for (const p of produtos) prodMap[p.id] = p

  // Junta o que o banco somou com o cadastro (nome, sku, categoria).
  const agg: Record<string, { nome: string; sku: string; categoria: string; quantidade: number; faturamento: number; lucro: number }> = {}
  for (const v of vendidos) {
    const p = prodMap[v.produto_id]
    if (!p) continue
    agg[v.produto_id] = {
      nome: p.nome, sku: p.sku ?? '', categoria: p.categoria ?? 'Sem categoria',
      quantidade: Number(v.quantidade ?? 0),
      faturamento: Number(v.faturamento ?? 0),
      lucro: Number(v.lucro ?? 0),
    }
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
