import { createClient } from '@/lib/supabase/server'
import VendasBIClient from '@/components/relatorios/VendasBIClient'

export const dynamic = 'force-dynamic'

export default async function RelatorioVendasPage({
  searchParams,
}: { searchParams: Promise<{ inicio?: string; fim?: string; agrupar?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicio = sp.inicio ?? new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
  const fim = sp.fim ?? hoje.toISOString().slice(0, 10)
  const agrupar = sp.agrupar ?? 'dia'

  const inicioISO = `${inicio}T00:00:00`
  const fimISO = `${fim}T23:59:59`

  const [vendasRes, itensRes, vendedoresRes] = await Promise.all([
    supabase.from('vendas')
      .select('id, total, desconto, status, created_at, clientes(nome), vendedores(nome)')
      .eq('empresa_id', empresaId)
      .gte('created_at', inicioISO)
      .lte('created_at', fimISO)
      .order('created_at', { ascending: true }),
    supabase.from('venda_itens')
      .select('produto_id, quantidade, preco_unitario, custo_unitario, produtos(nome, categoria, marca)')
      .in('venda_id',
        (await supabase.from('vendas').select('id')
          .eq('empresa_id', empresaId)
          .gte('created_at', inicioISO)
          .lte('created_at', fimISO)
          .eq('status', 'concluida')
        ).data?.map(v => v.id) ?? []
      ),
    supabase.from('vendedores').select('id, nome').eq('empresa_id', empresaId),
  ])

  const vendas = vendasRes.data ?? []
  const itens = itensRes.data ?? []
  const vendedores = vendedoresRes.data ?? []

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

  // Por categoria
  const porCategoria: Record<string, { faturamento: number; qtd: number }> = {}
  for (const it of itens) {
    const cat = (it.produtos as any)?.categoria ?? 'Sem categoria'
    if (!porCategoria[cat]) porCategoria[cat] = { faturamento: 0, qtd: 0 }
    porCategoria[cat].faturamento += Number(it.preco_unitario ?? 0) * Number(it.quantidade ?? 0)
    porCategoria[cat].qtd += Number(it.quantidade ?? 0)
  }
  const topCategorias = Object.entries(porCategoria)
    .map(([cat, val]) => ({ cat, ...val }))
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 10)

  // Por vendedor
  const porVendedor: Record<string, { nome: string; faturamento: number; qtd: number }> = {}
  for (const v of vendas) {
    if (v.status !== 'concluida') continue
    const vend = v.vendedores as any
    const nome = vend?.nome ?? 'Sem vendedor'
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
