import { createClient } from '@/lib/supabase/server'
import DashboardBIClient from '@/components/relatorios/DashboardBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { inicioDoMes, inicioDoMesAnterior, inicioDoProximoMes, inicioDeDiasAtras } from '@/lib/datas'

export const dynamic = 'force-dynamic'

export default async function RelatorioDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  // Limites no fuso da loja, com fim EXCLUSIVO (>= inicio, < fim). O
  // "23:59:59" de antes perdia as vendas do ultimo segundo do mes e, pior,
  // marcava a virada em UTC — tres horas antes da virada em Sao Paulo.
  const inicioMesAtual = inicioDoMes(hoje).toISOString()
  const fimMesAtual = inicioDoProximoMes(hoje).toISOString()
  const inicioMesAnterior = inicioDoMesAnterior(hoje).toISOString()
  const fimMesAnterior = inicioMesAtual

  // Últimos 30 dias para o gráfico de evolução
  const inicio30 = inicioDeDiasAtras(29, hoje)

  const [
    vendasMesAtual,
    vendasMesAnterior,
    vendas30dias,
    resumoEstoqueRes,
    contasPagar,
    contasReceber,
  ] = await Promise.all([
    // Tudo que e soma vem somado do banco. Este bloco buscava as linhas e as
    // reduzia aqui — e o PostgREST corta em 1.000 linhas, calado. Com 1.701
    // vendas no mes e 14.263 produtos ativos, TODOS os numeros desta tela
    // estavam menores que a verdade: o faturamento do mes por 41%, o capital
    // em estoque por uma ordem de grandeza.
    supabase.rpc('vendas_resumo', { p_empresa: empresaId, p_inicio: inicioMesAtual, p_fim: fimMesAtual }),
    supabase.rpc('vendas_resumo', { p_empresa: empresaId, p_inicio: inicioMesAnterior, p_fim: fimMesAnterior }),
    supabase.rpc('vendas_por_dia', { p_empresa: empresaId, p_inicio: inicio30.toISOString() }),
    supabase.rpc('estoque_resumo', { p_empresa: empresaId }),
    supabase.from('contas_pagar').select('valor, status, vencimento').eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']),
    supabase.from('contas_receber').select('valor, status, vencimento').eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']),
  ])

  // Evolucao dos ultimos 30 dias. O banco devolve so os dias COM venda; a
  // grade de 30 posicoes continua sendo montada aqui para o grafico nao pular
  // dia parado — dia sem venda tambem e informacao.
  const porDia = new Map<string, { faturamento: number; qtd: number }>(
    (vendas30dias.data ?? []).map((d: { dia: string; faturamento: number; quantidade: number }) => [
      d.dia, { faturamento: Number(d.faturamento ?? 0), qtd: Number(d.quantidade ?? 0) },
    ])
  )
  const evolucao = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(inicio30)
    d.setDate(d.getDate() + i)
    const chave = d.toISOString().slice(0, 10)
    const val = porDia.get(chave) ?? { faturamento: 0, qtd: 0 }
    return { data: chave.slice(5), ...val } // MM-DD
  })

  // KPIs mes atual e anterior — uma linha cada, ja somada no banco.
  const resumoAtual = (vendasMesAtual.data ?? [])[0] ?? { faturamento: 0, quantidade: 0, desconto: 0 }
  const faturamento = Number(resumoAtual.faturamento ?? 0)
  const qtdVendas = Number(resumoAtual.quantidade ?? 0)
  const ticketMedio = qtdVendas ? faturamento / qtdVendas : 0
  const totalDesconto = Number(resumoAtual.desconto ?? 0)

  const resumoAnterior = (vendasMesAnterior.data ?? [])[0] ?? { faturamento: 0, quantidade: 0 }
  const faturamentoAnt = Number(resumoAnterior.faturamento ?? 0)
  const qtdVendasAnt = Number(resumoAnterior.quantidade ?? 0)

  // Estoque
  const resumoEstoque = (resumoEstoqueRes.data ?? [])[0] ?? { capital: 0, sem_estoque: 0 }
  const capitalEstoque = Number(resumoEstoque.capital ?? 0)
  const produtosSemEstoque = Number(resumoEstoque.sem_estoque ?? 0)

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
