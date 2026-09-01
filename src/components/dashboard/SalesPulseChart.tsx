'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export type SalesPulsePoint = {
  hora: string
  hoje: number | null
  media: number
}

const brl = (value: number) => value.toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export default function SalesPulseChart({ data }: { data: SalesPulsePoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Vendas acumuladas hoje comparadas à média das últimas oito semanas">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="vendasHoje" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.24} />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="hora" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis hide />
          <Tooltip
            formatter={(value, name) => [brl(Number(value)), name === 'hoje' ? 'Hoje' : 'Média histórica']}
            contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 12px 30px rgba(15,23,42,.08)', fontSize: 12 }}
          />
          <Area type="monotone" dataKey="media" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 5" fill="transparent" connectNulls />
          <Area type="monotone" dataKey="hoje" stroke="#4f46e5" strokeWidth={2.5} fill="url(#vendasHoje)" connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
