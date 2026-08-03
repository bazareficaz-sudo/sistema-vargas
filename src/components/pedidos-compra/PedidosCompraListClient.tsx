'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Status = 'rascunho' | 'em_cotacao' | 'aguardando_aprovacao' | 'enviado' | 'parcialmente_recebido' | 'recebido' | 'cancelado'

interface Pedido {
  id: string
  numero: string
  status: Status
  data_pedido: string
  previsao_entrega: string | null
  total: number
  observacoes: string | null
  qtdItens: number
  fornecedor_id: string | null
  fornecedores: { nome_fantasia: string; razao_social: string } | null
}

interface Fornecedor { id: string; nome_fantasia: string; razao_social: string }

interface Props {
  pedidos: Pedido[]
  fornecedores: Fornecedor[]
  empresaId: string
  /** Falha ao buscar os pedidos. Sem isso, erro de consulta virava lista vazia. */
  erro?: string | null
}

const STATUS: Record<Status, { label: string; color: string }> = {
  rascunho:               { label: 'Rascunho',               color: 'bg-slate-100 text-slate-600' },
  em_cotacao:             { label: 'Em cotação',             color: 'bg-yellow-100 text-yellow-700' },
  aguardando_aprovacao:   { label: 'Aguard. aprovação',      color: 'bg-orange-100 text-orange-700' },
  enviado:                { label: 'Enviado',                color: 'bg-blue-100 text-blue-700' },
  parcialmente_recebido:  { label: 'Parc. recebido',         color: 'bg-purple-100 text-purple-700' },
  recebido:               { label: 'Recebido',               color: 'bg-emerald-100 text-emerald-700' },
  cancelado:              { label: 'Cancelado',              color: 'bg-red-100 text-red-600' },
}

const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function PedidosCompraListClient({ pedidos, empresaId, erro }: Props) {
  const router = useRouter()
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<Status | ''>('')

  const filtrados = pedidos.filter(p => {
    const forn = p.fornecedores?.nome_fantasia || p.fornecedores?.razao_social || ''
    if (busca && !forn.toLowerCase().includes(busca.toLowerCase()) && !p.numero?.includes(busca)) return false
    if (filtroStatus && p.status !== filtroStatus) return false
    return true
  })

  function nomeFornecedor(p: Pedido) {
    return p.fornecedores?.nome_fantasia || p.fornecedores?.razao_social || '—'
  }

  async function duplicar(p: Pedido) {
    const res = await fetch('/api/pedidos-compra/salvar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pedido: {
          empresa_id: empresaId,
          fornecedor_id: p.fornecedor_id,
          status: 'rascunho',
          data_pedido: new Date().toISOString().slice(0, 10),
          subtotal: 0, total: 0, desconto_geral: 0, frete: 0, outras_despesas: 0,
        },
        itens: [],
      }),
    })
    const d = await res.json()
    if (d.id) router.push(`/dashboard/pedidos-compra/novo?id=${d.id}&clone=${p.id}`)
  }

  const counts = Object.fromEntries(
    Object.keys(STATUS).map(s => [s, pedidos.filter(p => p.status === s).length])
  ) as Record<Status, number>

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Pedidos ao Fornecedor</h1>
          <p className="text-slate-500 text-sm mt-0.5">{pedidos.length} pedido(s) no total</p>
        </div>
        <Link href="/dashboard/pedidos-compra/novo"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm">
          + Novo Pedido
        </Link>
      </div>

      {erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-700">Não foi possível carregar os pedidos</p>
          <p className="text-xs text-red-600 mt-0.5">{erro}</p>
        </div>
      )}

      {/* Status chips */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFiltroStatus('')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${filtroStatus === '' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
          Todos ({pedidos.length})
        </button>
        {(Object.entries(STATUS) as [Status, { label: string; color: string }][]).map(([key, cfg]) => counts[key] > 0 && (
          <button key={key} onClick={() => setFiltroStatus(filtroStatus === key ? '' : key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${filtroStatus === key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            {cfg.label} ({counts[key]})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por fornecedor ou nº..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-300">
            <span className="text-5xl mb-3">📋</span>
            <p className="text-sm">Nenhum pedido encontrado</p>
            <Link href="/dashboard/pedidos-compra/novo"
              className="mt-4 text-sm text-blue-600 hover:underline">
              Criar primeiro pedido →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Nº</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Fornecedor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">Itens</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">Total</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Data</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Prev. entrega</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtrados.map(p => {
                const st = STATUS[p.status] ?? STATUS.rascunho
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-slate-500">#{p.numero || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">{nomeFornecedor(p)}</span>
                      {p.observacoes && <p className="text-xs text-slate-400 truncate max-w-[200px]">{p.observacoes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{p.qtdItens}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{brl(p.total ?? 0)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {p.data_pedido ? new Date(p.data_pedido + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {p.previsao_entrega ? new Date(p.previsao_entrega + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/dashboard/pedidos-compra/novo?id=${p.id}`}
                          className="px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg">
                          ✏ Editar
                        </Link>
                        <button onClick={() => duplicar(p)}
                          className="px-2 py-1 text-xs bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg">
                          📋 Duplicar
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
