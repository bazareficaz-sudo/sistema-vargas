import { createClient } from '@/lib/supabase/server'
import EstoqueBIClient from '@/components/relatorios/EstoqueBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { buscarTudo } from '@/lib/supabase/paginar'
import { inicioDeDiasAtras } from '@/lib/datas'

export const dynamic = 'force-dynamic'

type ProdutoEstoque = {
  id: string; nome: string; sku: string | null; categoria: string | null; marca: string | null
  estoque: number | null; estoque_minimo: number | null
  preco_custo: number | null; preco_venda: number | null; ativo: boolean
}

export default async function RelatorioEstoquePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  // Últimos 30 dias para calcular giro
  const inicio30 = inicioDeDiasAtras(30)

  const [produtos, vendidosRes] = await Promise.all([
    // Paginado: sao 14.263 produtos ativos e o PostgREST entrega 1.000 por
    // requisicao. Sem isto, capital em estoque, ruptura e giro falavam dos
    // 1.000 primeiros produtos e chamavam esse pedaco de "total".
    buscarTudo<ProdutoEstoque>(
      (de, ate) => supabase.from('produtos')
        .select('id, nome, sku, categoria, marca, estoque, estoque_minimo, preco_custo, preco_venda, ativo')
        .eq('empresa_id', empresaId).eq('ativo', true).order('id').range(de, ate),
      { rotulo: 'produtos ativos (estoque)' },
    ),
    // O agrupamento por produto vem do banco. O caminho antigo — pegar os ids
    // das vendas e mandar todos num `.in()` — ja nascia truncado e virava uma
    // URL de dezenas de kilobytes.
    supabase.rpc('produtos_vendidos', { p_empresa: empresaId, p_inicio: inicio30.toISOString() }),
  ])

  const itensVendidos: Record<string, number> = {}
  for (const l of (vendidosRes.data ?? []) as { produto_id: string; quantidade: number }[]) {
    itensVendidos[l.produto_id] = Number(l.quantidade ?? 0)
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
