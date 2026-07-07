'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import EditarProdutoModal from './EditarProdutoModal'

type Produto = {
  id: string
  nome: string
  sku: string | null
  ean: string | null
  preco_venda: number
  preco_custo: number
  preco_promocional: number | null
  promocao_ativa: boolean
  promocao_inicio: string | null
  promocao_fim: string | null
  unidade: string
  categoria: string | null
  marca: string | null
  estoque: number
  estoque_minimo: number
  ativo: boolean
  disponivel_pdv: boolean
  permite_fracao: boolean
  ncm: string | null
  tipo: string
}

type Props = {
  produtos: Produto[]
  total: number
  totalAtivos: number
  totalInativos: number
  totalSimples: number
  totalKits: number
  totalEmPromocao: number
  pagina: number
  totalPaginas: number
  q: string
  abaAtiva: string
  promoFiltro: boolean
  empresaId: string
}

const ABAS = [
  { key: 'todos',    label: 'todos' },
  { key: 'simples',  label: 'simples' },
  { key: 'kit',      label: 'kits' },
  { key: 'generico', label: 'genéricos' },
  { key: 'insumo',   label: 'insumos' },
  { key: 'brinde',   label: 'brindes' },
]

export default function ProdutosClient({
  produtos: inicial, total, totalAtivos, totalSimples, totalKits, totalEmPromocao,
  pagina, totalPaginas, q: qInicial, abaAtiva: abaInicial, promoFiltro: promoInicial, empresaId
}: Props) {
  const router = useRouter()
  const [produtos, setProdutos] = useState(inicial)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [editando, setEditando] = useState<Produto | null>(null)
  const [q, setQ] = useState(qInicial)
  const [aba, setAba] = useState(abaInicial)
  const [promo, setPromo] = useState(promoInicial)

  // Sincroniza quando o servidor traz novos dados (navegação entre abas/busca)
  useEffect(() => { setProdutos(inicial) }, [inicial])
  useEffect(() => { setQ(qInicial) }, [qInicial])
  useEffect(() => { setAba(abaInicial) }, [abaInicial])
  useEffect(() => { setPromo(promoInicial) }, [promoInicial])

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams({ q, aba, pagina: String(pagina), promo: promo ? '1' : '', ...params })
    router.push(`/dashboard/produtos?${sp.toString()}`)
  }

  function buscar(e: React.FormEvent) {
    e.preventDefault()
    navegar({ q, pagina: '1' })
  }

  function toggleAll(checked: boolean) {
    setSelecionados(checked ? new Set(produtos.map(p => p.id)) : new Set())
  }

  function toggleOne(id: string) {
    setSelecionados(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function toggleAtivo(produto: Produto) {
    const sb = createClient()
    await sb.from('produtos').update({ ativo: !produto.ativo, updated_at: new Date().toISOString() }).eq('id', produto.id)
    setProdutos(prev => prev.map(p => p.id === produto.id ? { ...p, ativo: !p.ativo } : p))
  }

  async function togglePdv(produto: Produto) {
    const sb = createClient()
    await sb.from('produtos').update({ disponivel_pdv: !produto.disponivel_pdv, updated_at: new Date().toISOString() }).eq('id', produto.id)
    setProdutos(prev => prev.map(p => p.id === produto.id ? { ...p, disponivel_pdv: !p.disponivel_pdv } : p))
  }

  async function ativarSelecionados(ativo: boolean) {
    if (selecionados.size === 0) return
    const sb = createClient()
    await sb.from('produtos').update({ ativo, updated_at: new Date().toISOString() }).in('id', [...selecionados])
    setProdutos(prev => prev.map(p => selecionados.has(p.id) ? { ...p, ativo } : p))
    setSelecionados(new Set())
  }

  const onSaved = useCallback(() => {
    router.refresh()
  }, [router])

  const abaCounts: Record<string, number> = {
    todos: total,
    simples: totalSimples,
    kit: totalKits,
    generico: 0,
    insumo: 0,
    brinde: 0,
  }

  return (
    <>
      <EditarProdutoModal produto={editando} onClose={() => setEditando(null)} onSaved={onSaved} empresaId={empresaId} />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span className="hover:text-gray-600 cursor-pointer">início</span>
        <span>›</span>
        <span className="hover:text-gray-600 cursor-pointer">cadastros</span>
        <span>›</span>
        <span className="text-gray-600 font-medium">produtos</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-gray-900 text-xl font-semibold">Produtos</h1>
        <div className="flex items-center gap-2">
          {selecionados.size > 0 && (
            <div className="flex items-center gap-2 mr-2">
              <span className="text-sm text-gray-600">{selecionados.size} selecionado(s)</span>
              <button onClick={() => ativarSelecionados(true)} className="text-xs px-3 py-1.5 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 transition-colors">Ativar</button>
              <button onClick={() => ativarSelecionados(false)} className="text-xs px-3 py-1.5 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors">Desativar</button>
            </div>
          )}
          <button className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Novo produto
          </button>
        </div>
      </div>

      {/* Barra de busca e filtros */}
      <form onSubmit={buscar} className="flex items-center gap-2 mb-0">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Pesquise por nome, código (SKU) ou GTIN/EAN"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 bg-white"
          />
        </div>
        <button type="submit" className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 bg-white transition-colors">
          Buscar
        </button>
        <div className="flex items-center gap-1 ml-2">
          <button type="button" className="px-3 py-1.5 text-xs border border-blue-500 text-blue-600 rounded-full bg-blue-50">
            produtos ativos
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !promo
              setPromo(next)
              navegar({ promo: next ? '1' : '', pagina: '1' })
            }}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center gap-1.5 ${
              promo
                ? 'border-orange-400 text-orange-600 bg-orange-50 font-medium'
                : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-50'
            }`}
          >
            <span>🏷</span>
            em promoção
            {totalEmPromocao > 0 && (
              <span className={`text-xs font-semibold ${promo ? 'text-orange-500' : 'text-gray-400'}`}>
                {totalEmPromocao}
              </span>
            )}
          </button>
          <button type="button" onClick={() => { setQ(''); setPromo(false); navegar({ q: '', promo: '', pagina: '1' }) }}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            ⊗ limpar filtros
          </button>
        </div>
      </form>

      {/* Abas */}
      <div className="flex items-end gap-6 border-b border-gray-200 mt-4 mb-0">
        {ABAS.map(a => (
          <button
            key={a.key}
            onClick={() => { setAba(a.key); navegar({ aba: a.key, pagina: '1' }) }}
            className={`pb-3 text-sm flex items-center gap-1.5 border-b-2 transition-colors ${
              aba === a.key
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {a.label}
            <span className={`text-xs font-semibold ${aba === a.key ? 'text-blue-600' : 'text-gray-400'}`}>
              {(abaCounts[a.key] ?? 0).toLocaleString('pt-BR')}
            </span>
          </button>
        ))}
      </div>

      {/* Tabela */}
      <div className="border border-gray-200 rounded-b-xl overflow-hidden" style={{ background: 'rgb(252, 251, 248)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200" style={{ background: 'rgb(246, 245, 242)' }}>
              <th className="w-10 px-4 py-3">
                <input type="checkbox"
                  checked={selecionados.size === produtos.length && produtos.length > 0}
                  onChange={e => toggleAll(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
              </th>
              <th className="w-8 px-2 py-3"></th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Descrição</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Código (SKU)</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">GTIN/EAN</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Unidade</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Preço</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Custo</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Marca</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Estoque</th>
              <th className="text-center px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">Ativo</th>
              <th className="text-center px-3 py-3 font-medium text-gray-600 text-xs uppercase tracking-wide">PDV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {produtos.map(p => (
              <tr key={p.id} className={`hover:bg-blue-50/30 transition-colors group ${selecionados.has(p.id) ? 'bg-blue-50/50' : ''}`}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selecionados.has(p.id)} onChange={() => toggleOne(p.id)}
                    className="w-4 h-4 accent-blue-600" />
                </td>
                <td className="px-2 py-2.5">
                  <button
                    onClick={() => setEditando(p)}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-all text-lg leading-none"
                    title="Editar"
                  >
                    ✎
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setEditando(p)} className="text-left text-gray-900 hover:text-blue-600 font-medium max-w-xs truncate block transition-colors">
                      {p.nome}
                    </button>
                    {p.promocao_ativa && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-orange-100 text-orange-600 border border-orange-200 shrink-0">
                        🏷 PROMOÇÃO
                      </span>
                    )}
                    {!p.disponivel_pdv && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                        🚫 OCULTO NO PDV
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {p.categoria && <span className="text-xs text-gray-400">{p.categoria}</span>}
                    {p.promocao_ativa && p.preco_promocional && (
                      <span className="text-xs text-orange-500 font-medium">
                        {p.preco_promocional.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{p.sku ?? '—'}</td>
                <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{p.ean ?? '—'}</td>
                <td className="px-3 py-2.5 text-gray-600">{p.unidade}</td>
                <td className="px-3 py-2.5 text-right text-gray-900 font-medium">
                  {p.preco_venda > 0 ? p.preco_venda.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-600">
                  {p.preco_custo > 0 ? p.preco_custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2.5 text-gray-600 text-xs">{p.marca ?? '—'}</td>
                <td className="px-3 py-2.5 text-right text-gray-700">{p.estoque ?? 0}</td>
                <td className="px-3 py-2.5 text-center">
                  <button onClick={() => toggleAtivo(p)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${p.ativo ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.ativo ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => togglePdv(p)}
                    title={p.disponivel_pdv ? 'Visível no PDV — clique para ocultar' : 'Oculto no PDV — clique para exibir'}
                    className={`w-10 h-5 rounded-full transition-colors relative ${p.disponivel_pdv ? 'bg-green-500' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.disponivel_pdv ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
              </tr>
            ))}
            {produtos.length === 0 && (
              <tr><td colSpan={12} className="py-12 text-center text-gray-400">Nenhum produto encontrado.</td></tr>
            )}
          </tbody>
        </table>

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-xs text-gray-500">
              Mostrando {((pagina - 1) * 50) + 1}–{Math.min(pagina * 50, total)} de {total.toLocaleString('pt-BR')} produtos
            </p>
            <div className="flex items-center gap-1">
              <button disabled={pagina <= 1} onClick={() => navegar({ pagina: String(pagina - 1) })}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 bg-white transition-colors">
                ← Anterior
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-600 font-medium">{pagina} / {totalPaginas}</span>
              <button disabled={pagina >= totalPaginas} onClick={() => navegar({ pagina: String(pagina + 1) })}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 bg-white transition-colors">
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
