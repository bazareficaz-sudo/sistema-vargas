'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type ItemABC = { id: string; nome: string; sku: string; categoria: string; quantidade: number; faturamento: number; lucro: number; pctAcum: number; classe: 'A' | 'B' | 'C' }

const CLASSE_CLS = {
  A: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  B: 'bg-blue-100 text-blue-700 border border-blue-200',
  C: 'bg-gray-100 text-gray-600 border border-gray-200',
}

export default function ProdutosBIClient({
  curvaABC, semVenda, abaixoMinimo, resumo, filtros,
}: {
  curvaABC: ItemABC[]
  semVenda: { id: string; nome: string; sku: string; estoque: number; categoria: string }[]
  abaixoMinimo: { id: string; nome: string; estoque: number; minimo: number }[]
  resumo: { totalProdutos: number; totalComVenda: number; totalSemVenda: number; abaixoMinimo: number; classeA: number; classeB: number; classeC: number }
  filtros: { inicio: string; fim: string }
}) {
  const router = useRouter()
  const [inicio, setInicio] = useState(filtros.inicio)
  const [fim, setFim] = useState(filtros.fim)
  const [aba, setAba] = useState<'abc' | 'sem-venda' | 'abaixo-minimo'>('abc')
  const [busca, setBusca] = useState('')

  function aplicar() {
    router.push(`/dashboard/relatorios/produtos?inicio=${inicio}&fim=${fim}`)
  }

  const abcFiltrado = curvaABC.filter(p =>
    !busca || p.nome.toLowerCase().includes(busca.toLowerCase()) || p.sku.toLowerCase().includes(busca.toLowerCase())
  )

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>relatórios & BI</span><span>›</span>
        <span className="text-gray-600 font-medium">produtos & curva ABC</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Produtos & Curva ABC</h1>
          <p className="text-gray-500 text-sm mt-0.5">{resumo.totalComVenda} produtos vendidos no período</p>
        </div>
        <div className="flex-1" />
        <div className="flex gap-2 items-end flex-wrap">
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
          { label: 'Classe A (80%)', val: resumo.classeA, icon: '🥇', color: 'bg-emerald-50 text-emerald-700', sub: 'geram 80% do faturamento' },
          { label: 'Classe B (15%)', val: resumo.classeB, icon: '🥈', color: 'bg-blue-50 text-blue-700', sub: 'geram 15% do faturamento' },
          { label: 'Classe C (5%)', val: resumo.classeC, icon: '🥉', color: 'bg-gray-50 text-gray-600', sub: 'geram 5% do faturamento' },
          { label: 'Sem venda', val: resumo.totalSemVenda, icon: '⚠️', color: 'bg-orange-50 text-orange-700', sub: 'no período selecionado' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{k.icon}</span>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{k.label}</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{k.val}</p>
            <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Resumo ABC visual */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Distribuição da Curva ABC</h2>
        <div className="grid grid-cols-3 gap-4">
          {(['A', 'B', 'C'] as const).map(cls => {
            const itens = curvaABC.filter(p => p.classe === cls)
            const fatTotal = itens.reduce((s, p) => s + p.faturamento, 0)
            const lucroTotal = itens.reduce((s, p) => s + p.lucro, 0)
            return (
              <div key={cls} className={`rounded-xl p-4 ${cls === 'A' ? 'bg-emerald-50 border border-emerald-200' : cls === 'B' ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${CLASSE_CLS[cls]}`}>{cls}</span>
                  <span className="text-xs text-gray-500">{itens.length} produtos</span>
                </div>
                <p className="text-base font-bold text-gray-900">{brl(fatTotal)}</p>
                <p className="text-xs text-gray-500">Lucro: {brl(lucroTotal)}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'abc', label: `Curva ABC (${curvaABC.length})` },
          { key: 'sem-venda', label: `Sem venda (${resumo.totalSemVenda})` },
          { key: 'abaixo-minimo', label: `Estoque crítico (${resumo.abaixoMinimo})` },
        ].map(t => (
          <button key={t.key} onClick={() => setAba(t.key as any)}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${aba === t.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tabela ABC */}
      {aba === 'abc' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto..."
              className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Produto</th>
                  <th className="text-left px-4 py-3">Categoria</th>
                  <th className="text-right px-4 py-3">Qtd</th>
                  <th className="text-right px-4 py-3">Faturamento</th>
                  <th className="text-right px-4 py-3">Lucro</th>
                  <th className="text-right px-4 py-3">% Acum.</th>
                  <th className="text-center px-4 py-3">Classe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {abcFiltrado.slice(0, 100).map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{p.nome}</p>
                      {p.sku && <p className="text-xs text-gray-400">{p.sku}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.categoria}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{p.quantidade.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{brl(p.faturamento)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${p.lucro >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{brl(p.lucro)}</td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">{p.pctAcum.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${CLASSE_CLS[p.classe]}`}>{p.classe}</span>
                    </td>
                  </tr>
                ))}
                {abcFiltrado.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sem venda */}
      {aba === 'sem-venda' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium uppercase tracking-wide">
                <th className="text-left px-4 py-3">Produto</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-right px-4 py-3">Estoque atual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {semVenda.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{p.nome}</p>
                    {p.sku && <p className="text-xs text-gray-400">{p.sku}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{p.categoria}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{p.estoque.toLocaleString('pt-BR')}</td>
                </tr>
              ))}
              {semVenda.length === 0 && (
                <tr><td colSpan={3} className="py-10 text-center text-emerald-600">✓ Todos os produtos foram vendidos no período!</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Abaixo do mínimo */}
      {aba === 'abaixo-minimo' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium uppercase tracking-wide">
                <th className="text-left px-4 py-3">Produto</th>
                <th className="text-right px-4 py-3">Estoque atual</th>
                <th className="text-right px-4 py-3">Estoque mínimo</th>
                <th className="text-right px-4 py-3">Déficit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {abaixoMinimo.map(p => (
                <tr key={p.id} className="hover:bg-red-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.nome}</td>
                  <td className="px-4 py-3 text-right text-red-600 font-semibold">{p.estoque}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{p.minimo}</td>
                  <td className="px-4 py-3 text-right text-red-500 font-medium">−{p.minimo - p.estoque}</td>
                </tr>
              ))}
              {abaixoMinimo.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-emerald-600">✓ Estoque de todos os produtos acima do mínimo!</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
