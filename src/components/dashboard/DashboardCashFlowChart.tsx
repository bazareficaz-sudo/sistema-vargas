'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export type CashFlowPoint = {
  data: string
  label: string
  entradas: number
  saidas: number
  saldo: number
}

const compactBrl = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(value)

const brl = (value: number) => value.toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export default function DashboardCashFlowChart({ data }: { data: CashFlowPoint[] }) {
  return (
    <div className="h-72 w-full" aria-label="Gráfico do saldo operacional previsto para os próximos 30 dias">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="saldoPositivo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            interval={6}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={compactBrl}
            width={70}
          />
          <Tooltip
            formatter={(value, name) => [brl(Number(value)), name === 'saldo' ? 'Saldo acumulado' : name === 'entradas' ? 'Entradas do dia' : 'Saídas do dia']}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.data ?? ''}
            contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 12px 30px rgba(15,23,42,.08)' }}
          />
          <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" />
          <Area type="monotone" dataKey="saldo" stroke="#4f46e5" strokeWidth={2.5} fill="url(#saldoPositivo)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
