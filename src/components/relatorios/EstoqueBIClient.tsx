'use client'

import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Produto = {
  id: string; nome: string; sku: string; categoria: string
  estoque: number; estoqueMinimo: number; custo: number; preco: number
  capitalInvestido: number; vendido30: number; diasCobertura: number | null; giro30: number
}

function CoberturaTag({ dias }: { dias: number | null }) {
  if (dias === null) return <span className="text-xs text-gray-400">Sem giro</span>
  if (dias === 0) return <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Sem estoque</span>
  if (dias <= 7) return <span className="text-xs font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full">⚠️ {dias}d</span>
  if (dias <= 30) return <span className="text-xs font-medium text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full">{dias}d</span>
  if (dias <= 90) return <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{dias}d</span>
  return <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{dias}d</span>
}

export default function EstoqueBIClient({
  lista, topCategorias, kpis,
}: {
  lista: Produto[]
  topCategorias: { cat: string; capital: number; qtdProdutos: number; semEstoque: number }[]
  kpis: { capitalTotal: number; semEstoque: number; abaixoMinimo: number; semMovimento: number; criticosCobertura: number; totalProdutos: number }
}) {
  const [aba, setAba] = useState<'todos' | 'criticos' | 'parados' | 'sem-estoque'>('todos')
  const [busca, setBusca] = useState('')
  const [ordenar, setOrdenar] = useState<'capital' | 'estoque' | 'cobertura' | 'giro'>('capital')

  const filtrado = lista
    .filter(p => {
      if (busca && !p.nome.toLowerCase().includes(busca.toLowerCase()) && !p.sku.toLowerCase().includes(busca.toLowerCase())) return false
      if (aba === 'criticos') return p.diasCobertura !== null && p.diasCobertura <= 7
      if (aba === 'parados') return p.vendido30 === 0
      if (aba === 'sem-estoque') return p.estoque <= 0
      return true
    })
    .sort((a, b) => {
      if (ordenar === 'capital') return b.capitalInvestido - a.capitalInvestido
      if (ordenar === 'estoque') return b.estoque - a.estoque
      if (ordenar === 'cobertura') return (a.diasCobertura ?? 9999) - (b.diasCobertura ?? 9999)
      return b.giro30 - a.giro30
    })

  const maxCap = topCategorias[0]?.capital ?? 1

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>relatórios & BI</span><span>›</span>
        <span className="text-gray-600 font-medium">estoque & giro</span>
      </div>

      <div className="mb-6">
        <h1 className="text-gray-900 text-xl font-semibold">Estoque & Giro</h1>
        <p className="text-gray-500 text-sm mt-0.5">{kpis.totalProdutos} produtos ativos — análise últimos 30 dias</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Capital em Estoque', val: brl(kpis.capitalTotal), icon: '💰', color: 'bg-blue-50 text-blue-700', sub: 'custo × quantidade' },
          { label: 'Sem Estoque', val: kpis.semEstoque, icon: '⛔', color: 'bg-red-50 text-red-700', sub: 'rupturas ativas' },
          { label: 'Abaixo do Mínimo', val: kpis.abaixoMinimo, icon: '⚠️', color: 'bg-orange-50 text-orange-700', sub: 'reposição urgente' },
          { label: 'Sem Movimentação', val: kpis.semMovimento, icon: '🧊', color: 'bg-gray-50 text-gray-600', sub: 'últimos 30 dias' },
          { label: 'Cobertura Crítica', val: kpis.criticosCobertura, icon: '🔴', color: 'bg-red-50 text-red-700', sub: 'acabam em < 7 dias' },
          { label: 'Total Produtos', val: kpis.totalProdutos, icon: '📦', color: 'bg-purple-50 text-purple-700', sub: 'ativos no catálogo' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{k.icon}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${k.color}`}>{k.label}</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{typeof k.val === 'number' && k.label !== 'Capital em Estoque' ? k.val.toLocaleString('pt-BR') : k.val}</p>
            <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Capital por categoria */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Capital investido por categoria</h2>
        <div className="space-y-2">
          {topCategorias.map((c, i) => (
            <div key={c.cat}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-gray-700 font-medium">{c.cat} <span className="text-gray-400">({c.qtdProdutos} prod.)</span></span>
                <div className="flex items-center gap-3">
                  {c.semEstoque > 0 && <span className="text-red-500">⚠️ {c.semEstoque} sem estoque</span>}
                  <span className="font-semibold text-gray-900">{brl(c.capital)}</span>
                </div>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${(c.capital / maxCap) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Abas + Tabela */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {[
          { key: 'todos', label: 'Todos' },
          { key: 'criticos', label: `Cobertura crítica (${kpis.criticosCobertura})` },
          { key: 'parados', label: `Sem movimento (${kpis.semMovimento})` },
          { key: 'sem-estoque', label: `Ruptura (${kpis.semEstoque})` },
        ].map(t => (
          <button key={t.key} onClick={() => setAba(t.key as any)}
            className={`px-3 py-2 text-sm rounded-lg font-medium transition-colors ${aba === t.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..."
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 w-44" />
        <select value={ordenar} onChange={e => setOrdenar(e.target.value as any)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
          <option value="capital">Ordenar: Capital</option>
          <option value="estoque">Ordenar: Estoque</option>
          <option value="cobertura">Ordenar: Cobertura</option>
          <option value="giro">Ordenar: Giro</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium uppercase tracking-wide">
              <th className="text-left px-4 py-3">Produto</th>
              <th className="text-right px-4 py-3">Estoque</th>
              <th className="text-right px-4 py-3">Capital</th>
              <th className="text-right px-4 py-3">Vendido 30d</th>
              <th className="text-right px-4 py-3">Giro 30d</th>
              <th className="text-center px-4 py-3">Cobertura</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtrado.slice(0, 100).map(p => (
              <tr key={p.id} className={`hover:bg-gray-50 ${p.estoque <= 0 ? 'bg-red-50/40' : p.estoque < p.estoqueMinimo ? 'bg-orange-50/40' : ''}`}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{p.nome}</p>
                  {p.sku && <p className="text-xs text-gray-400">{p.sku}</p>}
                  <p className="text-xs text-gray-400">{p.categoria}</p>
                </td>
                <td className={`px-4 py-3 text-right font-semibold ${p.estoque <= 0 ? 'text-red-600' : p.estoque < p.estoqueMinimo ? 'text-orange-600' : 'text-gray-900'}`}>
                  {p.estoque.toLocaleString('pt-BR')}
                  {p.estoqueMinimo > 0 && <span className="text-gray-400 font-normal"> / mín {p.estoqueMinimo}</span>}
                </td>
                <td className="px-4 py-3 text-right text-gray-700 font-medium">{brl(p.capitalInvestido)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{p.vendido30.toLocaleString('pt-BR')}</td>
                <td className="px-4 py-3 text-right text-gray-500">{p.giro30.toFixed(2)}x</td>
                <td className="px-4 py-3 text-center"><CoberturaTag dias={p.diasCobertura} /></td>
              </tr>
            ))}
            {filtrado.length === 0 && (
              <tr><td colSpan={6} className="py-10 text-center text-gray-400">Nenhum produto nesta categoria.</td></tr>
            )}
          </tbody>
        </table>
        {filtrado.length > 100 && (
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400 text-center">
            Exibindo 100 de {filtrado.length} produtos. Use a busca para filtrar.
          </div>
        )}
      </div>
    </div>
  )
}
