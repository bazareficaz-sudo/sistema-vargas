'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

// Barras empilhadas do mês a mês: em cada mês, o que foi pago, o que venceu
// sem pagar e o que ainda vai vencer. A altura da barra é o total de boletos.

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const curto = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : String(Math.round(v))

export default function GraficoMesAMes({ dados }: {
  dados: { rotulo: string; pago: number; vencido: number; aVencer: number }[]
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={curto} width={48} />
          <Tooltip formatter={(v) => brl(Number(v))} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="pago" name="Pago" stackId="m" fill="#22c55e" />
          <Bar dataKey="vencido" name="Vencido sem pagar" stackId="m" fill="#ef4444" />
          <Bar dataKey="aVencer" name="A vencer" stackId="m" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
