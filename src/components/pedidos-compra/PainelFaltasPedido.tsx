'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LinhaCompra } from '@/lib/faltas/listaCompra'

// Aba "Faltas" do Pedido ao Fornecedor.
//
// A lista de compra (faltas do balcão + abaixo do mínimo) consultada sem sair
// do pedido. Duas abas: as deste fornecedor, e as outras — muitas vezes o
// mesmo fornecedor tem o item que o balcão anotou e ninguém ligou a ele, e
// "aproveitar o pedido" é exatamente pegar essas.
//
// Incluir no pedido não mexe na falta aqui: ao salvar, a rota de salvar liga
// as faltas abertas dos produtos do pedido a ele (status "Na lista"/"Pedido").

const brl = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function PainelFaltasPedido({ fornecedorId, nomeFornecedor, noCarrinho, onAdicionar }: {
  fornecedorId: string
  nomeFornecedor: string
  noCarrinho: Set<string>
  onAdicionar: (itens: { linha: LinhaCompra; quantidade: number }[]) => void
}) {
  const [linhas, setLinhas] = useState<LinhaCompra[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<'deste' | 'outras'>('deste')
  const [busca, setBusca] = useState('')
  const [qtd, setQtd] = useState<Record<string, string>>({})
  const [marcados, setMarcados] = useState<Set<string>>(new Set())

  const carregar = useCallback(async () => {
    setErro('')
    try {
      const d = await fetch('/api/faltas/lista-compra').then(r => r.json())
      if (!d.ok) throw new Error(d.erro ?? 'Erro ao carregar as faltas')
      setLinhas(d.linhas ?? [])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as faltas')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(carregar, 0)
    return () => clearTimeout(t)
  }, [carregar])

  const deste = useMemo(() => linhas.filter(l => fornecedorId && l.fornecedor?.id === fornecedorId), [linhas, fornecedorId])
  const outras = useMemo(() => linhas.filter(l => !fornecedorId || l.fornecedor?.id !== fornecedorId), [linhas, fornecedorId])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const base = aba === 'deste' ? deste : outras
    return t ? base.filter(l => `${l.nome} ${l.sku ?? ''} ${l.fornecedor?.nome ?? ''}`.toLowerCase().includes(t)) : base
  }, [aba, deste, outras, busca])

  const quantidadeDe = (l: LinhaCompra) => {
    const v = parseFloat((qtd[l.produtoId] ?? '').replace(',', '.'))
    return v > 0 ? v : l.quantidadeSugerida
  }

  function adicionar(ls: LinhaCompra[]) {
    const novos = ls.filter(l => !noCarrinho.has(l.produtoId))
    if (novos.length === 0) return
    onAdicionar(novos.map(l => ({ linha: l, quantidade: quantidadeDe(l) })))
    setMarcados(new Set())
  }

  function alternar(id: string) {
    setMarcados(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  const marcadosVisiveis = visiveis.filter(l => marcados.has(l.produtoId) && !noCarrinho.has(l.produtoId))

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 pt-3 pb-2 border-b border-slate-100 space-y-2">
        <div className="flex items-center gap-1">
          <button onClick={() => setAba('deste')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${aba === 'deste' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            Deste fornecedor ({deste.length})
          </button>
          <button onClick={() => setAba('outras')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${aba === 'outras' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            Outras faltas ({outras.length})
          </button>
          <button onClick={() => { setCarregando(true); carregar() }} title="Recarregar"
            className="ml-auto px-2 py-1 text-xs text-slate-400 hover:text-slate-600">↻</button>
        </div>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Filtrar por produto ou fornecedor…"
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
        <p className="text-[11px] text-slate-400">
          {aba === 'deste'
            ? (fornecedorId
              ? `Faltas e itens abaixo do mínimo cujo fornecedor (padrão ou última compra) é ${nomeFornecedor || 'este'}.`
              : 'Escolha o fornecedor do pedido para ver as faltas dele.')
            : 'Faltas de outros fornecedores ou sem fornecedor — dá para aproveitar este pedido.'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {carregando ? (
          <p className="text-center py-10 text-xs text-slate-400">Carregando faltas…</p>
        ) : erro ? (
          <p className="text-center py-10 text-xs text-red-600">{erro}</p>
        ) : visiveis.length === 0 ? (
          <p className="text-center py-10 text-xs text-slate-400">Nenhuma falta aqui.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visiveis.map(l => {
              const jaTem = noCarrinho.has(l.produtoId)
              return (
                <li key={l.produtoId} className={`px-4 py-2.5 flex items-start gap-3 ${jaTem ? 'opacity-50' : ''}`}>
                  <input type="checkbox" className="mt-1" disabled={jaTem}
                    checked={marcados.has(l.produtoId) && !jaTem} onChange={() => alternar(l.produtoId)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm text-slate-800">{l.nome}</span>
                      {l.temEncomenda && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">📌 Encomenda</span>}
                      {l.vendedor && !l.temEncomenda && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">👤 Vendedor{l.solicitacoes > 1 ? ` ×${l.solicitacoes}` : ''}</span>}
                      {l.automatico && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">🤖 Automático</span>}
                      {l.noPedido && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">no pedido #{l.noPedido}</span>}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {l.sku && <span className="font-mono mr-2">{l.sku}</span>}
                      estoque <span className={l.estoque > 0 ? 'text-slate-700' : 'text-red-600 font-semibold'}>{l.estoque}</span>
                      {l.estoqueMinimo > 0 && <> · mín. {l.estoqueMinimo}</>}
                      {l.custo > 0 && <> · custo {brl(l.custo)}</>}
                      {aba === 'outras' && <> · 🏭 {l.fornecedor?.nome ?? 'sem fornecedor'}</>}
                    </p>
                  </div>
                  {jaTem ? (
                    <span className="text-[11px] text-emerald-600 shrink-0 mt-1">no carrinho ✓</span>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <input value={qtd[l.produtoId] ?? String(l.quantidadeSugerida)} inputMode="decimal"
                        onChange={e => setQtd(prev => ({ ...prev, [l.produtoId]: e.target.value }))}
                        onFocus={e => e.target.select()}
                        className="w-14 border border-slate-200 rounded px-1.5 py-1 text-xs text-right" title="Quantidade" />
                      <span className="text-[10px] text-slate-400">{l.unidade}</span>
                      <button onClick={() => adicionar([l])}
                        className="ml-1 px-2 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">+</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {marcadosVisiveis.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
          <button onClick={() => adicionar(marcadosVisiveis)}
            className="w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">
            Adicionar {marcadosVisiveis.length} ao pedido
          </button>
        </div>
      )}
    </div>
  )
}
