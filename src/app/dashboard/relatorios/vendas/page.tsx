import { createClient } from '@/lib/supabase/server'
import VendasBIClient from '@/components/relatorios/VendasBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { buscarTudo } from '@/lib/supabase/paginar'

export const dynamic = 'force-dynamic'

type VendaRelatorio = {
  id: string; total: number | null; desconto: number | null; status: string; created_at: string
  // O tipo gerado do PostgREST descreve relacao embutida como ARRAY, mesmo
  // quando ela e um-para-um. A tela ja lia esses dois campos com `as any` por
  // causa disso; aqui as duas formas sao aceitas em vez de fingir uma so.
  clientes: { nome: string } | { nome: string }[] | null
  vendedores: { nome: string } | { nome: string }[] | null
}

export default async function RelatorioVendasPage({
  searchParams,
}: { searchParams: Promise<{ inicio?: string; fim?: string; agrupar?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicio = sp.inicio ?? new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
  const fim = sp.fim ?? hoje.toISOString().slice(0, 10)
  const agrupar = sp.agrupar ?? 'dia'

  const inicioISO = `${inicio}T00:00:00`
  const fimISO = `${fim}T23:59:59`

  const [vendas, vendidosRes, produtosRes] = await Promise.all([
    // Paginado: a tela precisa das vendas uma a uma (venda por hora do dia,
    // por vendedor, por periodo), e o PostgREST entrega no maximo 1.000 por
    // requisicao. Com 1.701 vendas no mes, todo numero desta tela vinha menor.
    buscarTudo<VendaRelatorio>(
      (de, ate) => supabase.from('vendas')
        .select('id, total, desconto, status, created_at, clientes(nome), vendedores(nome)')
        .eq('empresa_id', empresaId)
        .gte('created_at', inicioISO)
        .lte('created_at', fimISO)
        .order('created_at', { ascending: true })
        .order('id')
        .range(de, ate),
      { rotulo: 'vendas (relatorio de vendas)' },
    ),
    // Categoria mais vendida: agrupado no banco. O caminho antigo montava um
    // `.in('venda_id', [...])` com todos os ids do periodo — alem de ja vir
    // truncado, era uma URL grande demais para ser respondida.
    supabase.rpc('produtos_vendidos', { p_empresa: empresaId, p_inicio: inicioISO, p_fim: fimISO }),
    buscarTudo<{ id: string; categoria: string | null }>(
      (de, ate) => supabase.from('produtos').select('id, categoria')
        .eq('empresa_id', empresaId).order('id').range(de, ate),
      { rotulo: 'produtos (categoria)' },
    ),
  ])

  // Agrupa por período
  const porPeriodo: Record<string, { faturamento: number; qtd: number; desconto: number }> = {}
  for (const v of vendas) {
    if (v.status !== 'concluida') continue
    const d = new Date(v.created_at)
    let key: string
    if (agrupar === 'semana') {
      const wStart = new Date(d); wStart.setDate(d.getDate() - d.getDay())
      key = wStart.toISOString().slice(0, 10)
    } else if (agrupar === 'mes') {
      key = d.toISOString().slice(0, 7)
    } else {
      key = d.toISOString().slice(0, 10)
    }
    if (!porPeriodo[key]) porPeriodo[key] = { faturamento: 0, qtd: 0, desconto: 0 }
    porPeriodo[key].faturamento += Number(v.total ?? 0)
    porPeriodo[key].qtd++
    porPeriodo[key].desconto += Number(v.desconto ?? 0)
  }
  const evolucao = Object.entries(porPeriodo)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, val]) => ({ data: data.slice(agrupar === 'mes' ? 0 : 5), ...val }))

  // Por hora do dia
  const porHora: Record<number, number> = {}
  for (let h = 0; h < 24; h++) porHora[h] = 0
  for (const v of vendas) {
    if (v.status !== 'concluida') continue
    porHora[new Date(v.created_at).getHours()]++
  }
  const heatmapHora = Object.entries(porHora).map(([h, qtd]) => ({ hora: `${h}h`, qtd }))

  // Por categoria — o banco soma por produto, e aqui os produtos viram
  // categoria. A categoria mora no cadastro (texto, nao chave), entao a
  // juncao acontece do lado de ca mesmo.
  const categoriaDoProduto = new Map(produtosRes.map(p => [p.id, p.categoria ?? 'Sem categoria']))
  const porCategoria: Record<string, { faturamento: number; qtd: number }> = {}
  for (const v of (vendidosRes.data ?? []) as { produto_id: string; quantidade: number; faturamento: number }[]) {
    const cat = categoriaDoProduto.get(v.produto_id) ?? 'Sem categoria'
    if (!porCategoria[cat]) porCategoria[cat] = { faturamento: 0, qtd: 0 }
    porCategoria[cat].faturamento += Number(v.faturamento ?? 0)
    porCategoria[cat].qtd += Number(v.quantidade ?? 0)
  }
  const topCategorias = Object.entries(porCategoria)
    .map(([cat, val]) => ({ cat, ...val }))
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 10)

  // Por vendedor
  const porVendedor: Record<string, { nome: string; faturamento: number; qtd: number }> = {}
  for (const v of vendas) {
    if (v.status !== 'concluida') continue
    const vend = v.vendedores
    const nome = (Array.isArray(vend) ? vend[0]?.nome : vend?.nome) ?? 'Sem vendedor'
    if (!porVendedor[nome]) porVendedor[nome] = { nome, faturamento: 0, qtd: 0 }
    porVendedor[nome].faturamento += Number(v.total ?? 0)
    porVendedor[nome].qtd++
  }
  const rankingVendedores = Object.values(porVendedor)
    .sort((a, b) => b.faturamento - a.faturamento)

  const vendasOk = vendas.filter(v => v.status === 'concluida')
  const totalFat = vendasOk.reduce((s, v) => s + Number(v.total ?? 0), 0)
  const totalDesc = vendasOk.reduce((s, v) => s + Number(v.desconto ?? 0), 0)
  const ticketMedio = vendasOk.length ? totalFat / vendasOk.length : 0

  return (
    <VendasBIClient
      evolucao={evolucao}
      heatmapHora={heatmapHora}
      topCategorias={topCategorias}
      rankingVendedores={rankingVendedores}
      totais={{ faturamento: totalFat, qtd: vendasOk.length, desconto: totalDesc, ticketMedio }}
      filtros={{ inicio, fim, agrupar }}
    />
  )
}
