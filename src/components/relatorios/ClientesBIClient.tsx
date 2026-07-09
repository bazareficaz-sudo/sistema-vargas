'use client'

import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const SEG_CLS: Record<string, string> = {
  'VIP': 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  'Fiel': 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'Em risco': 'bg-orange-100 text-orange-700 border border-orange-200',
  'Inativo': 'bg-red-100 text-red-600 border border-red-200',
  'Nunca comprou': 'bg-gray-100 text-gray-500 border border-gray-200',
}

const SEG_COLORS = ['#f59e0b', '#10b981', '#f97316', '#ef4444', '#94a3b8']

type Cliente = {
  id: string; nome: string; telefone: string
  totalGasto: number; qtdCompras: number
  ultimaCompra: string | null; diasSemComprar: number | null
  score: number; segmento: string
}

export default function ClientesBIClient({
  lista, topClientes, inativos90, segmentos, totalClientes,
}: {
  lista: Cliente[]
  topClientes: Cliente[]
  inativos90: Cliente[]
  segmentos: { vip: number; fiel: number; emRisco: number; inativo: number; nuncaComprou: number }
  totalClientes: number
}) {
  const [aba, setAba] = useState<'ranking' | 'rfm' | 'inativos'>('rfm')
  const [busca, setBusca] = useState('')
  const [filtroSeg, setFiltroSeg] = useState('')

  const pieData = [
    { name: 'VIP', value: segmentos.vip },
    { name: 'Fiel', value: segmentos.fiel },
    { name: 'Em risco', value: segmentos.emRisco },
    { name: 'Inativo', value: segmentos.inativo },
    { name: 'Nunca comprou', value: segmentos.nuncaComprou },
  ].filter(d => d.value > 0)

  const listaFiltrada = lista.filter(c => {
    if (filtroSeg && c.segmento !== filtroSeg) return false
    if (busca && !c.nome.toLowerCase().includes(busca.toLowerCase())) return false
    return true
  }).slice(0, 100)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>relatórios & BI</span><span>›</span>
        <span className="text-gray-600 font-medium">inteligência de clientes</span>
      </div>

      <div className="mb-6">
        <h1 className="text-gray-900 text-xl font-semibold">Inteligência de Clientes</h1>
        <p className="text-gray-500 text-sm mt-0.5">{totalClientes} clientes cadastrados — análise RFM (Recência, Frequência, Valor)</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'VIP', val: segmentos.vip, icon: '👑', cls: 'border-yellow-200 bg-yellow-50', txt: 'text-yellow-700', desc: 'alta frequência e valor' },
          { label: 'Fiel', val: segmentos.fiel, icon: '⭐', cls: 'border-emerald-200 bg-emerald-50', txt: 'text-emerald-700', desc: 'compra regularmente' },
          { label: 'Em risco', val: segmentos.emRisco, icon: '⚠️', cls: 'border-orange-200 bg-orange-50', txt: 'text-orange-700', desc: 'sumindo do radar' },
          { label: 'Inativo', val: segmentos.inativo, icon: '💤', cls: 'border-red-200 bg-red-50', txt: 'text-red-600', desc: '>90 dias sem comprar' },
          { label: 'Nunca comprou', val: segmentos.nuncaComprou, icon: '🆕', cls: 'border-gray-200 bg-gray-50', txt: 'text-gray-600', desc: 'cadastrado, sem compra' },
        ].map(k => (
          <button key={k.label} onClick={() => setFiltroSeg(filtroSeg === k.label ? '' : k.label)}
            className={`rounded-2xl border shadow-sm p-4 text-left transition-all hover:shadow-md ${k.cls} ${filtroSeg === k.label ? 'ring-2 ring-blue-400' : ''}`}>
            <span className="text-2xl">{k.icon}</span>
            <p className={`text-2xl font-bold mt-1 ${k.txt}`}>{k.val}</p>
            <p className="text-xs font-semibold text-gray-700">{k.label}</p>
            <p className="text-xs text-gray-400">{k.desc}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Pie */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Distribuição de Segmentos</h2>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={35}>
                {pieData.map((_, i) => <Cell key={i} fill={SEG_COLORS[i % SEG_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend iconSize={10} formatter={n => <span style={{ fontSize: 11 }}>{n}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top 5 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Top 5 Clientes</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <th className="text-left pb-2 font-medium">#</th>
                <th className="text-left pb-2 font-medium">Cliente</th>
                <th className="text-right pb-2 font-medium">Compras</th>
                <th className="text-right pb-2 font-medium">Total gasto</th>
                <th className="text-center pb-2 font-medium">Segmento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {topClientes.slice(0, 5).map((c, i) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="py-2.5 text-gray-400 text-xs">{i + 1}º</td>
                  <td className="py-2.5">
                    <p className="font-medium text-gray-900">{c.nome}</p>
                    {c.diasSemComprar !== null && <p className="text-xs text-gray-400">{c.diasSemComprar}d sem comprar</p>}
                  </td>
                  <td className="py-2.5 text-right text-gray-500">{c.qtdCompras}</td>
                  <td className="py-2.5 text-right font-semibold text-gray-900">{brl(c.totalGasto)}</td>
                  <td className="py-2.5 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEG_CLS[c.segmento] ?? ''}`}>{c.segmento}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'rfm', label: 'Todos os clientes' },
          { key: 'ranking', label: `Top compradores (${topClientes.length})` },
          { key: 'inativos', label: `Inativos +90d (${inativos90.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setAba(t.key as any)}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${aba === t.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        {aba === 'rfm' && (
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente..."
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 w-44" />
        )}
      </div>

      {/* Tabela RFM completa */}
      {aba === 'rfm' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {filtroSeg && (
            <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
              <span className="text-xs text-blue-700 font-medium">Filtrando: {filtroSeg}</span>
              <button onClick={() => setFiltroSeg('')} className="text-xs text-blue-500 hover:text-blue-700">✕ Limpar</button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium uppercase tracking-wide">
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-right px-4 py-3">Compras</th>
                <th className="text-right px-4 py-3">Total gasto</th>
                <th className="text-right px-4 py-3">Ticket médio</th>
                <th className="text-right px-4 py-3">Última compra</th>
                <th className="text-center px-4 py-3">Segmento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {listaFiltrada.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.nome}</p>
                    {c.telefone && <p className="text-xs text-gray-400">{c.telefone}</p>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.qtdCompras}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{brl(c.totalGasto)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.qtdCompras ? brl(c.totalGasto / c.qtdCompras) : '—'}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400">
                    {c.ultimaCompra
                      ? `${new Date(c.ultimaCompra).toLocaleDateString('pt-BR')} (${c.diasSemComprar}d atrás)`
                      : 'Nunca'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEG_CLS[c.segmento] ?? ''}`}>{c.segmento}</span>
                  </td>
                </tr>
              ))}
              {listaFiltrada.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400">Nenhum cliente encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Top compradores */}
      {aba === 'ranking' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium uppercase tracking-wide">
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-right px-4 py-3">Compras</th>
                <th className="text-right px-4 py-3">Total gasto</th>
                <th className="text-right px-4 py-3">Ticket médio</th>
                <th className="text-center px-4 py-3">Segmento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {topClientes.map((c, i) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{i + 1}º</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.qtdCompras}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{brl(c.totalGasto)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{brl(c.qtdCompras ? c.totalGasto / c.qtdCompras : 0)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEG_CLS[c.segmento] ?? ''}`}>{c.segmento}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inativos */}
      {aba === 'inativos' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-orange-50 border-b border-orange-100">
            <p className="text-sm text-orange-700 font-medium">
              💡 Ação recomendada: envie uma mensagem de reativação para estes clientes via WhatsApp
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium uppercase tracking-wide">
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Telefone</th>
                <th className="text-right px-4 py-3">Última compra</th>
                <th className="text-right px-4 py-3">Dias inativo</th>
                <th className="text-right px-4 py-3">Total gasto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {inativos90.map(c => (
                <tr key={c.id} className="hover:bg-orange-50/30">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.telefone || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs">
                    {c.ultimaCompra ? new Date(c.ultimaCompra).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${(c.diasSemComprar ?? 0) > 180 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-700'}`}>
                      {c.diasSemComprar}d
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-700">{brl(c.totalGasto)}</td>
                </tr>
              ))}
              {inativos90.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-emerald-600">✓ Nenhum cliente inativo há mais de 90 dias!</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
