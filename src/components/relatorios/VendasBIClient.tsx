'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const COLORS = ['#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#ef4444','#f97316','#f59e0b','#10b981']

export default function VendasBIClient({
  evolucao, heatmapHora, topCategorias, rankingVendedores, totais, filtros,
}: {
  evolucao: { data: string; faturamento: number; qtd: number; desconto: number }[]
  heatmapHora: { hora: string; qtd: number }[]
  topCategorias: { cat: string; faturamento: number; qtd: number }[]
  rankingVendedores: { nome: string; faturamento: number; qtd: number }[]
  totais: { faturamento: number; qtd: number; desconto: number; ticketMedio: number }
  filtros: { inicio: string; fim: string; agrupar: string }
}) {
  const router = useRouter()
  const [inicio, setInicio] = useState(filtros.inicio)
  const [fim, setFim] = useState(filtros.fim)
  const [agrupar, setAgrupar] = useState(filtros.agrupar)

  function aplicar() {
    router.push(`/dashboard/relatorios/vendas?inicio=${inicio}&fim=${fim}&agrupar=${agrupar}`)
  }

  const maxCat = topCategorias[0]?.faturamento ?? 1

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>relatórios & BI</span><span>›</span>
        <span className="text-gray-600 font-medium">análise de vendas</span>
      </div>

      {/* Header + Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Análise de Vendas</h1>
          <p className="text-gray-500 text-sm mt-0.5">{totais.qtd} vendas no período</p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Início</label>
            <input type="date" value={inicio} onChange={e => setInicio(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fim</label>
            <input type="date" value={fim} onChange={e => setFim(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Agrupar por</label>
            <select value={agrupar} onChange={e => setAgrupar(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
              <option value="dia">Dia</option>
              <option value="semana">Semana</option>
              <option value="mes">Mês</option>
            </select>
          </div>
          <button onClick={aplicar}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            Aplicar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Faturamento', val: brl(totais.faturamento), icon: '💵' },
          { label: 'Vendas', val: totais.qtd.toLocaleString('pt-BR'), icon: '🛒' },
          { label: 'Ticket Médio', val: brl(totais.ticketMedio), icon: '🎫' },
          { label: 'Descontos', val: brl(totais.desconto), icon: '🏷' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{k.icon}</span>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{k.label}</p>
            </div>
            <p className="text-xl font-bold text-gray-900">{k.val}</p>
          </div>
        ))}
      </div>

      {/* Gráfico evolução */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Faturamento por período</h2>
        {evolucao.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">Nenhuma venda no período.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={evolucao}>
              <defs>
                <linearGradient id="gFat" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="data" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
              <Tooltip formatter={(v: unknown, n: unknown) => [n === 'faturamento' ? brl(Number(v)) : String(v), n === 'faturamento' ? 'Faturamento' : 'Qtd vendas']}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Area type="monotone" dataKey="faturamento" stroke="#3b82f6" strokeWidth={2} fill="url(#gFat)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Por categoria */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Faturamento por categoria</h2>
          {topCategorias.length === 0 ? (
            <p className="text-center text-gray-400 py-6 text-sm">Sem dados.</p>
          ) : (
            <div className="space-y-2">
              {topCategorias.map((c, i) => (
                <div key={c.cat}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-gray-700 font-medium truncate max-w-[55%]">{c.cat}</span>
                    <span className="text-gray-500">{brl(c.faturamento)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${(c.faturamento / maxCat) * 100}%`,
                      background: COLORS[i % COLORS.length],
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Por hora */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Vendas por hora do dia</h2>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={heatmapHora} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="hora" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Bar dataKey="qtd" name="Vendas" radius={[3, 3, 0, 0]}>
                {heatmapHora.map((e, i) => (
                  <Cell key={i} fill={e.qtd === Math.max(...heatmapHora.map(h => h.qtd)) ? '#3b82f6' : '#bfdbfe'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Ranking vendedores */}
      {rankingVendedores.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Ranking de Vendedores</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left pb-2 font-medium">#</th>
                <th className="text-left pb-2 font-medium">Vendedor</th>
                <th className="text-right pb-2 font-medium">Vendas</th>
                <th className="text-right pb-2 font-medium">Faturamento</th>
                <th className="text-right pb-2 font-medium">Ticket Médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rankingVendedores.map((v, i) => (
                <tr key={v.nome} className="hover:bg-gray-50">
                  <td className="py-2.5 text-gray-400 text-xs">{i + 1}º</td>
                  <td className="py-2.5 font-medium text-gray-800">{v.nome}</td>
                  <td className="py-2.5 text-right text-gray-500">{v.qtd}</td>
                  <td className="py-2.5 text-right font-semibold text-gray-900">{brl(v.faturamento)}</td>
                  <td className="py-2.5 text-right text-gray-500">{brl(v.qtd ? v.faturamento / v.qtd : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
