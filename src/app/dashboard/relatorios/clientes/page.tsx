import { createClient } from '@/lib/supabase/server'
import ClientesBIClient from '@/components/relatorios/ClientesBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function RelatorioClientesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicio90 = new Date(hoje); inicio90.setDate(inicio90.getDate() - 90)

  const [clientesRes, vendasRes] = await Promise.all([
    supabase.from('clientes').select('id, nome, telefone, created_at').eq('empresa_id', empresaId),
    supabase.from('vendas')
      .select('id, total, status, created_at, cliente_id')
      .eq('empresa_id', empresaId)
      .eq('status', 'concluida')
      .order('created_at', { ascending: false }),
  ])

  const clientes = clientesRes.data ?? []
  const vendas = vendasRes.data ?? []

  // RFM por cliente
  const rfm: Record<string, {
    id: string; nome: string; telefone: string
    totalGasto: number; qtdCompras: number
    ultimaCompra: string | null; diasSemComprar: number | null
  }> = {}

  for (const c of clientes) {
    rfm[c.id] = {
      id: c.id, nome: c.nome, telefone: c.telefone ?? '',
      totalGasto: 0, qtdCompras: 0, ultimaCompra: null, diasSemComprar: null,
    }
  }

  for (const v of vendas) {
    if (!v.cliente_id || !rfm[v.cliente_id]) continue
    rfm[v.cliente_id].totalGasto += Number(v.total ?? 0)
    rfm[v.cliente_id].qtdCompras++
    if (!rfm[v.cliente_id].ultimaCompra || v.created_at > rfm[v.cliente_id].ultimaCompra!) {
      rfm[v.cliente_id].ultimaCompra = v.created_at
    }
  }

  // Calcula dias sem comprar
  const lista = Object.values(rfm).map(c => {
    const diasSemComprar = c.ultimaCompra
      ? Math.floor((hoje.getTime() - new Date(c.ultimaCompra).getTime()) / 86400000)
      : null
    // Score RFM simplificado
    const r = diasSemComprar === null ? 0 : diasSemComprar <= 30 ? 5 : diasSemComprar <= 60 ? 4 : diasSemComprar <= 90 ? 3 : diasSemComprar <= 180 ? 2 : 1
    const f = c.qtdCompras === 0 ? 0 : c.qtdCompras >= 10 ? 5 : c.qtdCompras >= 5 ? 4 : c.qtdCompras >= 3 ? 3 : c.qtdCompras >= 2 ? 2 : 1
    const allTotais = Object.values(rfm).map(x => x.totalGasto).sort((a, b) => b - a)
    const pos = allTotais.findIndex(t => t <= c.totalGasto)
    const pct = allTotais.length ? pos / allTotais.length : 0
    const m = pct <= 0.2 ? 5 : pct <= 0.4 ? 4 : pct <= 0.6 ? 3 : pct <= 0.8 ? 2 : 1
    const score = r + f + m
    const segmento = score >= 13 ? 'VIP' : score >= 9 ? 'Fiel' : score >= 6 ? 'Em risco' : c.qtdCompras === 0 ? 'Nunca comprou' : 'Inativo'

    return { ...c, diasSemComprar, score, segmento }
  })

  const segmentos = {
    vip: lista.filter(c => c.segmento === 'VIP').length,
    fiel: lista.filter(c => c.segmento === 'Fiel').length,
    emRisco: lista.filter(c => c.segmento === 'Em risco').length,
    inativo: lista.filter(c => c.segmento === 'Inativo').length,
    nuncaComprou: lista.filter(c => c.segmento === 'Nunca comprou').length,
  }

  const topClientes = lista
    .filter(c => c.qtdCompras > 0)
    .sort((a, b) => b.totalGasto - a.totalGasto)
    .slice(0, 50)

  const inativos90 = lista
    .filter(c => c.diasSemComprar !== null && c.diasSemComprar > 90)
    .sort((a, b) => (b.diasSemComprar ?? 0) - (a.diasSemComprar ?? 0))
    .slice(0, 50)

  return (
    <ClientesBIClient
      lista={lista.sort((a, b) => b.totalGasto - a.totalGasto)}
      topClientes={topClientes}
      inativos90={inativos90}
      segmentos={segmentos}
      totalClientes={clientes.length}
    />
  )
}
