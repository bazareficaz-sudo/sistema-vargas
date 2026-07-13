'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type ItemCompra = {
  id: string
  produto_id: string | null
  nome_produto: string
  sku: string | null
  quantidade: number
  preco_custo_anterior: number
  preco_custo_novo: number
  markup: number
  preco_venda_novo: number
  subtotal: number
  created_at: string
  entradas: {
    id: string
    numero_entrada: string | null
    numero_nf: string | null
    data_entrada: string | null
    status: string
    fornecedores: { id: string; razao_social: string; nome_fantasia: string | null } | null
  }
}

type Fornecedor = { id: string; razao_social: string; nome_fantasia: string | null }

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function pct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%' }

export default function ProdutosEntradasClient({
  itens: inicial,
  fornecedores,
  filtrosIniciais,
}: {
  itens: ItemCompra[]
  fornecedores: Fornecedor[]
  filtrosIniciais: { produto: string; fornecedor: string; de: string; ate: string }
}) {
  const router = useRouter()
  const [produto, setProduto] = useState(filtrosIniciais.produto)
  const [fornecedor, setFornecedor] = useState(filtrosIniciais.fornecedor)
  const [de, setDe] = useState(filtrosIniciais.de)
  const [ate, setAte] = useState(filtrosIniciais.ate)
  const [agrupar, setAgrupar] = useState<'item' | 'produto'>('item')

  const filtrados = useMemo(() => {
    const q = produto.toLowerCase().trim()
    const f = fornecedor.toLowerCase().trim()
    return inicial.filter(i => {
      if (q && !i.nome_produto.toLowerCase().includes(q) && !(i.sku ?? '').toLowerCase().includes(q)) return false
      if (f) {
        const forn = i.entradas.fornecedores
        if (!forn || !(forn.razao_social + (forn.nome_fantasia ?? '')).toLowerCase().includes(f)) return false
      }
      if (de && i.created_at < de) return false
      if (ate && i.created_at > ate + 'T23:59:59') return false
      return true
    })
  }, [inicial, produto, fornecedor, de, ate])

  // Agrupamento por produto
  const agrupados = useMemo(() => {
    if (agrupar !== 'produto') return null
    const map: Record<string, {
      produto_id: string | null; nome: string; sku: string | null
      totalQtd: number; totalGasto: number; entradas: number
      ultimoCusto: number; primeiroCusto: number; ultimaData: string
    }> = {}
    for (const i of filtrados) {
      const chave = i.produto_id ?? i.nome_produto
      if (!map[chave]) {
        map[chave] = {
          produto_id: i.produto_id,
          nome: i.nome_produto,
          sku: i.sku,
          totalQtd: 0, totalGasto: 0, entradas: 0,
          ultimoCusto: 0, primeiroCusto: 0, ultimaData: i.created_at,
        }
      }
      const g = map[chave]
      g.totalQtd += Number(i.quantidade)
      g.totalGasto += Number(i.subtotal)
      g.entradas += 1
      if (i.created_at > g.ultimaData) { g.ultimaData = i.created_at; g.ultimoCusto = Number(i.preco_custo_novo) }
      if (i.created_at < g.ultimaData || g.primeiroCusto === 0) g.primeiroCusto = Number(i.preco_custo_novo)
    }
    return Object.values(map).sort((a, b) => b.totalGasto - a.totalGasto)
  }, [filtrados, agrupar])

  const temFiltro = produto || fornecedor || de || ate
  function limpar() { setProduto(''); setFornecedor(''); setDe(''); setAte('') }

  const totalGasto = filtrados.reduce((s, i) => s + Number(i.subtotal), 0)
  const totalQtd = filtrados.reduce((s, i) => s + Number(i.quantidade), 0)

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/entradas" className="hover:text-gray-600">entradas</a><span>›</span>
        <span className="text-gray-600 font-medium">produtos comprados</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Produtos Comprados</h1>
          <p className="text-gray-500 text-sm mt-0.5">Histórico de compras de mercadoria por produto</p>
        </div>
        <Link href="/dashboard/entradas"
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
          ← Voltar às entradas
        </Link>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">Registros encontrados</p>
          <p className="text-xl font-bold text-gray-900">{filtrados.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">Total de unidades</p>
          <p className="text-xl font-bold text-blue-700">{totalQtd.toLocaleString('pt-BR')}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">Total investido</p>
          <p className="text-xl font-bold text-emerald-700">{fmt(totalGasto)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">Produto (nome ou SKU)</label>
          <input value={produto} onChange={e => setProduto(e.target.value)} placeholder="Buscar produto..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs text-gray-500 mb-1">Fornecedor</label>
          <input value={fornecedor} onChange={e => setFornecedor(e.target.value)} placeholder="Buscar fornecedor..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">De</label>
          <input type="date" value={de} onChange={e => setDe(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Até</label>
          <input type="date" value={ate} onChange={e => setAte(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        {temFiltro && (
          <button onClick={limpar} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
            ✕ Limpar
          </button>
        )}
        <div className="ml-auto flex items-end">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button onClick={() => setAgrupar('item')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${agrupar === 'item' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
              Por compra
            </button>
            <button onClick={() => setAgrupar('produto')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${agrupar === 'produto' ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
              Por produto
            </button>
          </div>
        </div>
      </div>

      {/* Tabela agrupada por produto */}
      {agrupar === 'produto' && agrupados && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Produto</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Qtd total</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Entradas</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Últ. custo</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Total gasto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agrupados.map(g => (
                <tr key={g.produto_id ?? g.nome} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 text-sm">{g.nome}</p>
                    {g.sku && <p className="text-xs text-gray-400 font-mono">{g.sku}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-700">{g.totalQtd.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3 text-center text-gray-500">{g.entradas}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{fmt(g.ultimoCusto)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(g.totalGasto)}</td>
                </tr>
              ))}
              {agrupados.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabela por compra (item a item) */}
      {agrupar === 'item' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Produto</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Fornecedor</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Entrada</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-28">Data</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-20">Qtd</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Custo ant.</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Custo novo</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-24">Variação</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Preço venda</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-32">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(i => {
                const varCusto = Number(i.preco_custo_anterior) > 0
                  ? ((Number(i.preco_custo_novo) - Number(i.preco_custo_anterior)) / Number(i.preco_custo_anterior)) * 100 : null
                const fornNome = i.entradas.fornecedores?.nome_fantasia ?? i.entradas.fornecedores?.razao_social ?? '—'
                const dataEntradaRaw = i.entradas.data_entrada
                const dataEntradaDate = dataEntradaRaw
                  ? new Date(dataEntradaRaw.length <= 10 ? dataEntradaRaw + 'T00:00:00' : dataEntradaRaw)
                  : null
                const data = dataEntradaDate && !isNaN(dataEntradaDate.getTime())
                  ? dataEntradaDate.toLocaleDateString('pt-BR')
                  : new Date(i.created_at).toLocaleDateString('pt-BR')
                return (
                  <tr key={i.id} className="group hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{i.nome_produto}</p>
                      {i.sku && <p className="text-xs text-gray-400 font-mono">{i.sku}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[180px] truncate">{fornNome}</td>
                    <td className="px-4 py-3">
                      {i.entradas.numero_entrada ? (
                        <Link href={`/dashboard/entradas/${i.entradas.id}`}
                          className="font-mono text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded hover:bg-blue-100">
                          {i.entradas.numero_entrada}
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{data}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{Number(i.quantidade).toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      {Number(i.preco_custo_anterior) > 0 ? fmt(Number(i.preco_custo_anterior)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">{fmt(Number(i.preco_custo_novo))}</td>
                    <td className="px-4 py-3 text-right">
                      {varCusto !== null ? (
                        <span className={`text-xs font-semibold ${varCusto > 0.1 ? 'text-red-600' : varCusto < -0.1 ? 'text-emerald-600' : 'text-gray-400'}`}>
                          {pct(varCusto)}
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{fmt(Number(i.preco_venda_novo))}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(Number(i.subtotal))}</td>
                  </tr>
                )
              })}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-gray-400">
                    {temFiltro ? 'Nenhum produto encontrado com esses filtros.' : 'Nenhuma compra registrada ainda.'}
                  </td>
                </tr>
              )}
            </tbody>
            {filtrados.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td colSpan={4} className="px-4 py-3 text-sm text-gray-600">{filtrados.length} item(s)</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{totalQtd.toLocaleString('pt-BR')}</td>
                  <td colSpan={3}></td>
                  <td></td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(totalGasto)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
