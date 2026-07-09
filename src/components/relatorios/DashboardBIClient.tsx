'use client'

import Link from 'next/link'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from 'recharts'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (atual: number, ant: number) => ant === 0 ? null : ((atual - ant) / ant) * 100

function Delta({ atual, anterior }: { atual: number; anterior: number }) {
  const d = pct(atual, anterior)
  if (d === null) return null
  const up = d >= 0
  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'} {Math.abs(d).toFixed(1)}% vs mês ant.
    </span>
  )
}

function KpiCard({
  label, value, sub, icon, color, delta,
}: {
  label: string; value: string; sub?: string; icon: string
  color: string; delta?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
      {delta}
    </div>
  )
}

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

export default function DashboardBIClient({
  kpis, evolucao, mesAtual,
}: {
  kpis: {
    faturamento: number; faturamentoAnt: number
    qtdVendas: number; qtdVendasAnt: number
    ticketMedio: number; totalDesconto: number
    capitalEstoque: number; produtosSemEstoque: number
    totalPagar: number; totalVencidoPagar: number
    totalReceber: number; totalVencidoReceber: number
    saldoLiquido: number
  }
  evolucao: { data: string; faturamento: number; qtd: number }[]
  mesAtual: number
}) {
  const mes = MESES[mesAtual]

  const quickLinks = [
    { href: '/dashboard/relatorios/vendas',     label: 'Análise de Vendas',        icon: '📈' },
    { href: '/dashboard/relatorios/produtos',   label: 'Produtos & Curva ABC',      icon: '🏆' },
    { href: '/dashboard/relatorios/estoque',    label: 'Estoque & Giro',            icon: '📦' },
    { href: '/dashboard/relatorios/financeiro', label: 'Fluxo Financeiro',          icon: '💰' },
    { href: '/dashboard/relatorios/clientes',   label: 'Inteligência de Clientes',  icon: '👥' },
    { href: '/dashboard/relatorios/alertas',    label: 'Alertas Inteligentes',      icon: '🔔' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>relatórios & BI</span><span>›</span>
        <span className="text-gray-600 font-medium">dashboard executivo</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Dashboard Executivo</h1>
          <p className="text-gray-500 text-sm mt-0.5">Visão geral do negócio — {mes}</p>
        </div>
        <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-full font-medium">
          📊 Centro de Inteligência
        </span>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Faturamento" icon="💵"
          value={brl(kpis.faturamento)}
          sub={`${kpis.qtdVendas} vendas em ${mes}`}
          color="bg-blue-50 text-blue-700"
          delta={<Delta atual={kpis.faturamento} anterior={kpis.faturamentoAnt} />}
        />
        <KpiCard
          label="Ticket Médio" icon="🎫"
          value={brl(kpis.ticketMedio)}
          sub="por venda concluída"
          color="bg-indigo-50 text-indigo-700"
          delta={<Delta atual={kpis.qtdVendas} anterior={kpis.qtdVendasAnt} />}
        />
        <KpiCard
          label="A Receber" icon="💰"
          value={brl(kpis.totalReceber)}
          sub={kpis.totalVencidoReceber > 0 ? `⚠️ ${brl(kpis.totalVencidoReceber)} vencido` : 'em dia'}
          color="bg-emerald-50 text-emerald-700"
        />
        <KpiCard
          label="A Pagar" icon="💳"
          value={brl(kpis.totalPagar)}
          sub={kpis.totalVencidoPagar > 0 ? `⚠️ ${brl(kpis.totalVencidoPagar)} vencido` : 'em dia'}
          color="bg-orange-50 text-orange-700"
        />
      </div>

      {/* Segunda linha de KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Capital em Estoque" icon="📦"
          value={brl(kpis.capitalEstoque)}
          sub={`${kpis.produtosSemEstoque} produtos sem estoque`}
          color="bg-purple-50 text-purple-700"
        />
        <KpiCard
          label="Saldo Líquido" icon={kpis.saldoLiquido >= 0 ? '✅' : '⛔'}
          value={brl(kpis.saldoLiquido)}
          sub="receber − pagar"
          color={kpis.saldoLiquido >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}
        />
        <KpiCard
          label="Descontos" icon="🏷"
          value={brl(kpis.totalDesconto)}
          sub={`concedidos em ${mes}`}
          color="bg-yellow-50 text-yellow-700"
        />
        <KpiCard
          label="Vendas no mês" icon="🛒"
          value={kpis.qtdVendas.toLocaleString('pt-BR')}
          sub="transações concluídas"
          color="bg-sky-50 text-sky-700"
          delta={<Delta atual={kpis.qtdVendas} anterior={kpis.qtdVendasAnt} />}
        />
      </div>

      {/* Gráfico de evolução 30 dias */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Faturamento — últimos 30 dias</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={evolucao} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradFat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="data" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip
              formatter={(v: number) => [brl(v), 'Faturamento']}
              contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
            />
            <Area type="monotone" dataKey="faturamento" stroke="#3b82f6" strokeWidth={2} fill="url(#gradFat)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Quick links para módulos */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {quickLinks.map(l => (
          <Link key={l.href} href={l.href}
            className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3 hover:border-blue-300 hover:shadow-md transition-all group">
            <span className="text-2xl">{l.icon}</span>
            <span className="text-sm font-medium text-gray-700 group-hover:text-blue-700 transition-colors">{l.label} →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
