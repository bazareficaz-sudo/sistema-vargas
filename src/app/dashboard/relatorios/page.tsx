import { createClient } from '@/lib/supabase/server'
import DashboardBIClient from '@/components/relatorios/DashboardBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function RelatorioDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicioMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString()
  const fimMesAtual = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59).toISOString()
  const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString()
  const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59).toISOString()

  // Últimos 30 dias para o gráfico de evolução
  const inicio30 = new Date(hoje)
  inicio30.setDate(inicio30.getDate() - 29)
  inicio30.setHours(0, 0, 0, 0)

  const [
    vendasMesAtual,
    vendasMesAnterior,
    vendas30dias,
    produtos,
    contasPagar,
    contasReceber,
  ] = await Promise.all([
    supabase.from('vendas').select('total, desconto, status, created_at')
      .eq('empresa_id', empresaId).gte('created_at', inicioMesAtual).lte('created_at', fimMesAtual),
    supabase.from('vendas').select('total, status')
      .eq('empresa_id', empresaId).gte('created_at', inicioMesAnterior).lte('created_at', fimMesAnterior),
    supabase.from('vendas').select('total, status, created_at')
      .eq('empresa_id', empresaId).gte('created_at', inicio30.toISOString()),
    supabase.from('produtos').select('preco_custo, estoque, ativo').eq('empresa_id', empresaId),
    supabase.from('contas_pagar').select('valor, status, vencimento').eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']),
    supabase.from('contas_receber').select('valor, status, vencimento').eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']),
  ])

  // Agrega vendas dos últimos 30 dias por data
  const evolucaoMap: Record<string, { faturamento: number; qtd: number }> = {}
  for (let i = 0; i < 30; i++) {
    const d = new Date(inicio30)
    d.setDate(d.getDate() + i)
    evolucaoMap[d.toISOString().slice(0, 10)] = { faturamento: 0, qtd: 0 }
  }
  for (const v of vendas30dias.data ?? []) {
    if (v.status !== 'concluida') continue
    const dia = v.created_at.slice(0, 10)
    if (evolucaoMap[dia]) {
      evolucaoMap[dia].faturamento += Number(v.total ?? 0)
      evolucaoMap[dia].qtd++
    }
  }
  const evolucao = Object.entries(evolucaoMap).map(([data, val]) => ({
    data: data.slice(5), // MM-DD
    ...val,
  }))

  // KPIs mês atual
  const vendasOk = (vendasMesAtual.data ?? []).filter(v => v.status === 'concluida')
  const faturamento = vendasOk.reduce((s, v) => s + Number(v.total ?? 0), 0)
  const qtdVendas = vendasOk.length
  const ticketMedio = qtdVendas ? faturamento / qtdVendas : 0
  const totalDesconto = vendasOk.reduce((s, v) => s + Number(v.desconto ?? 0), 0)

  // KPIs mês anterior
  const vendasOkAnt = (vendasMesAnterior.data ?? []).filter(v => v.status === 'concluida')
  const faturamentoAnt = vendasOkAnt.reduce((s, v) => s + Number(v.total ?? 0), 0)
  const qtdVendasAnt = vendasOkAnt.length

  // Estoque
  const prods = produtos.data ?? []
  const capitalEstoque = prods.filter(p => p.ativo).reduce((s, p) => s + Number(p.preco_custo ?? 0) * Number(p.estoque ?? 0), 0)
  const produtosSemEstoque = prods.filter(p => p.ativo && Number(p.estoque ?? 0) <= 0).length

  // Contas
  const totalPagar = (contasPagar.data ?? []).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const totalVencidoPagar = (contasPagar.data ?? []).filter(c => c.status === 'vencido').reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const totalReceber = (contasReceber.data ?? []).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const totalVencidoReceber = (contasReceber.data ?? []).filter(c => c.status === 'vencido').reduce((s, c) => s + Number(c.valor ?? 0), 0)

  const kpis = {
    faturamento, faturamentoAnt,
    qtdVendas, qtdVendasAnt,
    ticketMedio,
    totalDesconto,
    capitalEstoque,
    produtosSemEstoque,
    totalPagar, totalVencidoPagar,
    totalReceber, totalVencidoReceber,
    saldoLiquido: totalReceber - totalPagar,
  }

  return <DashboardBIClient kpis={kpis} evolucao={evolucao} mesAtual={hoje.getMonth()} />
}
