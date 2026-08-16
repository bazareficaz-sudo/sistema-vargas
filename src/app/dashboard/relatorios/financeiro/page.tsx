import { createClient } from '@/lib/supabase/server'
import FinanceiroBIClient from '@/components/relatorios/FinanceiroBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function RelatorioFinanceiroPage({
  searchParams,
}: { searchParams: Promise<{ inicio?: string; fim?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicio = sp.inicio ?? new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
  const fim = sp.fim ?? new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10)

  const [pagarRes, receberRes] = await Promise.all([
    supabase.from('contas_pagar')
      .select('valor, status, vencimento, descricao, fornecedores(razao_social, nome_fantasia)')
      .eq('empresa_id', empresaId)
      .gte('vencimento', inicio)
      .lte('vencimento', fim)
      .order('vencimento'),
    supabase.from('contas_receber')
      .select('valor, status, vencimento, descricao, clientes(nome)')
      .eq('empresa_id', empresaId)
      .gte('vencimento', inicio)
      .lte('vencimento', fim)
      .order('vencimento'),
  ])

  const pagar = pagarRes.data ?? []
  const receber = receberRes.data ?? []

  // Fluxo dia a dia
  const fluxoMap: Record<string, { entradas: number; saidas: number }> = {}
  const addDia = (d: string) => { if (!fluxoMap[d]) fluxoMap[d] = { entradas: 0, saidas: 0 } }

  for (const c of receber) {
    const d = c.vencimento?.slice(0, 10)
    if (!d) continue
    addDia(d)
    fluxoMap[d].entradas += Number(c.valor ?? 0)
  }
  for (const c of pagar) {
    const d = c.vencimento?.slice(0, 10)
    if (!d) continue
    addDia(d)
    fluxoMap[d].saidas += Number(c.valor ?? 0)
  }

  const fluxo = Object.entries(fluxoMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, v]) => ({ data: data.slice(5), ...v, saldo: v.entradas - v.saidas }))

  // KPIs
  const totalReceber = receber.reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const totalPagar = pagar.reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const recebido = receber.filter(c => c.status === 'recebido').reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const pago = pagar.filter(c => c.status === 'pago').reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const vencidoReceber = receber.filter(c => c.status === 'vencido').reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const vencidoPagar = pagar.filter(c => c.status === 'vencido').reduce((s, c) => s + Number(c.valor ?? 0), 0)

  const kpis = {
    totalReceber, totalPagar, recebido, pago,
    vencidoReceber, vencidoPagar,
    saldoPeriodo: totalReceber - totalPagar,
    inadimplencia: totalReceber > 0 ? (vencidoReceber / totalReceber) * 100 : 0,
  }

  return (
    <FinanceiroBIClient
      fluxo={fluxo}
      kpis={kpis}
      contasPagar={pagar.map(c => ({
        descricao: c.descricao ?? '',
        vencimento: c.vencimento ?? '',
        valor: Number(c.valor ?? 0),
        status: c.status ?? '',
        fornecedor: (c.fornecedores as any)?.nome_fantasia ?? (c.fornecedores as any)?.razao_social ?? '',
      }))}
      contasReceber={receber.map(c => ({
        descricao: c.descricao ?? '',
        vencimento: c.vencimento ?? '',
        valor: Number(c.valor ?? 0),
        status: c.status ?? '',
        cliente: (c.clientes as any)?.nome ?? '',
      }))}
      filtros={{ inicio, fim }}
    />
  )
}
