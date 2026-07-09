'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STATUS_CLS: Record<string, string> = {
  pago: 'bg-emerald-100 text-emerald-700',
  recebido: 'bg-emerald-100 text-emerald-700',
  pendente: 'bg-yellow-100 text-yellow-700',
  vencido: 'bg-red-100 text-red-600',
}

export default function FinanceiroBIClient({
  fluxo, kpis, contasPagar, contasReceber, filtros,
}: {
  fluxo: { data: string; entradas: number; saidas: number; saldo: number }[]
  kpis: {
    totalReceber: number; totalPagar: number; recebido: number; pago: number
    vencidoReceber: number; vencidoPagar: number; saldoPeriodo: number; inadimplencia: number
  }
  contasPagar: { descricao: string; vencimento: string; valor: number; status: string; fornecedor: string }[]
  contasReceber: { descricao: string; vencimento: string; valor: number; status: string; cliente: string }[]
  filtros: { inicio: string; fim: string }
}) {
  const router = useRouter()
  const [inicio, setInicio] = useState(filtros.inicio)
  const [fim, setFim] = useState(filtros.fim)
  const [aba, setAba] = useState<'fluxo' | 'pagar' | 'receber'>('fluxo')

  function aplicar() {
    router.push(`/dashboard/relatorios/financeiro?inicio=${inicio}&fim=${fim}`)
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>relatórios & BI</span><span>›</span>
        <span className="text-gray-600 font-medium">fluxo financeiro</span>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Fluxo Financeiro</h1>
          <p className="text-gray-500 text-sm mt-0.5">Entradas, saídas e saldo do período</p>
        </div>
        <div className="flex-1" />
        <div className="flex gap-2 items-end">
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
          <button onClick={aplicar}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            Aplicar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total a Receber', val: brl(kpis.totalReceber), icon: '💰', color: 'bg-emerald-50 text-emerald-700' },
          { label: 'Total a Pagar', val: brl(kpis.totalPagar), icon: '💳', color: 'bg-orange-50 text-orange-700' },
          { label: 'Saldo do Período', val: brl(kpis.saldoPeriodo), icon: kpis.saldoPeriodo >= 0 ? '✅' : '⛔', color: kpis.saldoPeriodo >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700' },
          { label: 'Inadimplência', val: `${kpis.inadimplencia.toFixed(1)}%`, icon: '⚠️', color: kpis.inadimplencia > 5 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{k.icon}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${k.color}`}>{k.label}</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{k.val}</p>
          </div>
        ))}
      </div>

      {/* Segunda linha KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Já Recebido', val: brl(kpis.recebido), icon: '✔️', color: 'bg-emerald-50 text-emerald-700' },
          { label: 'Já Pago', val: brl(kpis.pago), icon: '✔️', color: 'bg-blue-50 text-blue-700' },
          { label: 'Vencido a Receber', val: brl(kpis.vencidoReceber), icon: '🔴', color: 'bg-red-50 text-red-700' },
          { label: 'Vencido a Pagar', val: brl(kpis.vencidoPagar), icon: '🔴', color: 'bg-red-50 text-red-700' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{k.icon}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${k.color}`}>{k.label}</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{k.val}</p>
          </div>
        ))}
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'fluxo', label: 'Fluxo de Caixa' },
          { key: 'receber', label: `A Receber (${contasReceber.length})` },
          { key: 'pagar', label: `A Pagar (${contasPagar.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setAba(t.key as any)}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${aba === t.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Gráfico fluxo */}
      {aba === 'fluxo' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Entradas vs Saídas por dia</h2>
          {fluxo.length === 0 ? (
            <p className="text-center text-gray-400 py-10 text-sm">Nenhum lançamento no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={fluxo}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="data" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip formatter={(v: number, n) => [brl(v), n === 'entradas' ? 'Entradas' : n === 'saidas' ? 'Saídas' : 'Saldo']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend formatter={n => n === 'entradas' ? 'Entradas' : n === 'saidas' ? 'Saídas' : 'Saldo'} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Bar dataKey="entradas" fill="#10b981" opacity={0.8} radius={[3, 3, 0, 0]} />
                <Bar dataKey="saidas" fill="#f97316" opacity={0.8} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="saldo" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Tabela contas a receber */}
      {aba === 'receber' && (
        <ContasTable contas={contasReceber} tipo="receber" />
      )}

      {/* Tabela contas a pagar */}
      {aba === 'pagar' && (
        <ContasTable contas={contasPagar} tipo="pagar" />
      )}
    </div>
  )
}

function ContasTable({
  contas, tipo,
}: {
  contas: { descricao: string; vencimento: string; valor: number; status: string; fornecedor?: string; cliente?: string }[]
  tipo: 'pagar' | 'receber'
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium uppercase tracking-wide">
            <th className="text-left px-4 py-3">Descrição</th>
            <th className="text-left px-4 py-3">{tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}</th>
            <th className="text-left px-4 py-3">Vencimento</th>
            <th className="text-right px-4 py-3">Valor</th>
            <th className="text-center px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {contas.map((c, i) => (
            <tr key={i} className={`hover:bg-gray-50 ${c.status === 'vencido' ? 'bg-red-50/40' : ''}`}>
              <td className="px-4 py-3 text-gray-800 font-medium">{c.descricao || '—'}</td>
              <td className="px-4 py-3 text-gray-500 text-xs">{tipo === 'pagar' ? c.fornecedor : c.cliente || '—'}</td>
              <td className="px-4 py-3 text-gray-500 text-xs">
                {c.vencimento ? new Date(c.vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-gray-900">{brl(c.valor)}</td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {c.status}
                </span>
              </td>
            </tr>
          ))}
          {contas.length === 0 && (
            <tr><td colSpan={5} className="py-10 text-center text-gray-400">Nenhum lançamento no período.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
