'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type OrcItem = { id: string; produto_nome: string; quantidade: number; preco_unitario: number; desconto: number; total: number }
type Orcamento = {
  id: string; numero: number; status: string
  cliente_nome: string | null; operador_nome: string | null
  subtotal: number; desconto: number; total: number
  observacao: string | null; validade: string | null
  created_at: string
  clientes: { nome: string; telefone: string | null } | null
  orcamento_itens: OrcItem[]
}

const STATUS_LABEL: Record<string, { label: string; cor: string }> = {
  aberto:     { label: 'Aberto',     cor: 'bg-blue-100 text-blue-700' },
  aprovado:   { label: 'Aprovado',   cor: 'bg-green-100 text-green-700' },
  cancelado:  { label: 'Cancelado',  cor: 'bg-red-100 text-red-600' },
  convertido: { label: 'Convertido', cor: 'bg-gray-100 text-gray-500' },
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('pt-BR') }
function fmtDateTime(s: string) { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }

export default function OrcamentosClient({ empresaId, orcamentos: inicial }: { empresaId: string; orcamentos: Orcamento[] }) {
  const sb = createClient()
  const router = useRouter()
  const [lista, setLista] = useState<Orcamento[]>(inicial)
  const [selecionado, setSelecionado] = useState<Orcamento | null>(null)
  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [atualizando, setAtualizando] = useState(false)

  const filtrado = lista.filter(o => {
    const matchStatus = filtroStatus === 'todos' || o.status === filtroStatus
    const q = filtroBusca.toLowerCase()
    const matchBusca = !q || String(o.numero).includes(q) ||
      (o.cliente_nome ?? '').toLowerCase().includes(q) ||
      (o.observacao ?? '').toLowerCase().includes(q)
    return matchStatus && matchBusca
  })

  async function alterarStatus(id: string, status: string) {
    setAtualizando(true)
    await sb.from('orcamentos').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setLista(p => p.map(o => o.id === id ? { ...o, status } : o))
    if (selecionado?.id === id) setSelecionado(p => p ? { ...p, status } : p)
    setAtualizando(false)
  }

  async function excluir(id: string) {
    if (!confirm('Excluir este orçamento?')) return
    await sb.from('orcamentos').delete().eq('id', id)
    setLista(p => p.filter(o => o.id !== id))
    if (selecionado?.id === id) setSelecionado(null)
  }

  const vencido = (o: Orcamento) => o.validade && o.status === 'aberto' && new Date(o.validade) < new Date()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'rgb(252,251,248)' }}>

      {/* ── LISTA ───────────────────────────────────────────────── */}
      <div className={`flex flex-col border-r border-gray-200 bg-white ${selecionado ? 'w-96 flex-shrink-0' : 'flex-1'}`}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Orçamentos</h1>
            <button onClick={() => router.push('/pdv')}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded-lg">
              + Novo no PDV
            </button>
          </div>
          <input value={filtroBusca} onChange={e => setFiltroBusca(e.target.value)}
            placeholder="Buscar por número, cliente..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 mb-2" />
          <div className="flex gap-1">
            {['todos', 'aberto', 'aprovado', 'cancelado', 'convertido'].map(s => (
              <button key={s} onClick={() => setFiltroStatus(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${filtroStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {s === 'todos' ? 'Todos' : STATUS_LABEL[s]?.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filtrado.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
              <span className="text-4xl">📋</span>
              <p className="text-sm">Nenhum orçamento encontrado</p>
            </div>
          ) : (
            filtrado.map(o => (
              <div key={o.id} onClick={() => setSelecionado(o.id === selecionado?.id ? null : o)}
                className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${o.id === selecionado?.id ? 'bg-amber-50 border-l-2 border-l-amber-400' : 'hover:bg-gray-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-sm">#{o.numero}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_LABEL[o.status]?.cor}`}>
                        {STATUS_LABEL[o.status]?.label}
                      </span>
                      {vencido(o) && <span className="text-xs text-red-500 font-medium">vencido</span>}
                    </div>
                    <p className="text-sm text-gray-600 truncate mt-0.5">
                      {o.cliente_nome ?? o.clientes?.nome ?? 'Consumidor'}
                    </p>
                    <p className="text-xs text-gray-400">{fmtDateTime(o.created_at)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-900">{fmt(o.total)}</p>
                    <p className="text-xs text-gray-400">{o.orcamento_itens.length} itens</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── DETALHE ─────────────────────────────────────────────── */}
      {selecionado && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6 space-y-5">
            {/* Header detalhe */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-gray-900">Orçamento #{selecionado.numero}</h2>
                  <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_LABEL[selecionado.status]?.cor}`}>
                    {STATUS_LABEL[selecionado.status]?.label}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1">{fmtDateTime(selecionado.created_at)}</p>
              </div>
              <button onClick={() => setSelecionado(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            {/* Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">Cliente</p>
                <p className="font-medium text-gray-900">{selecionado.cliente_nome ?? selecionado.clientes?.nome ?? 'Consumidor'}</p>
                {selecionado.clientes?.telefone && <p className="text-xs text-gray-500">{selecionado.clientes.telefone}</p>}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">Validade</p>
                <p className={`font-medium ${vencido(selecionado) ? 'text-red-600' : 'text-gray-900'}`}>
                  {selecionado.validade ? fmtDate(selecionado.validade) : 'Sem prazo'}
                  {vencido(selecionado) && ' (vencido)'}
                </p>
                <p className="text-xs text-gray-500">Operador: {selecionado.operador_nome?.split('@')[0]}</p>
              </div>
            </div>

            {/* Itens */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2">Produto</th>
                    <th className="text-center px-2 py-2 w-16">Qtd</th>
                    <th className="text-right px-2 py-2 w-24">Preço</th>
                    <th className="text-center px-2 py-2 w-16">Desc%</th>
                    <th className="text-right px-4 py-2 w-24">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selecionado.orcamento_itens.map((item, i) => (
                    <tr key={item.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2 font-medium text-gray-900">{item.produto_nome}</td>
                      <td className="px-2 py-2 text-center text-gray-600">{item.quantidade}</td>
                      <td className="px-2 py-2 text-right text-gray-600">{fmt(item.preco_unitario)}</td>
                      <td className="px-2 py-2 text-center text-gray-500">{item.desconto > 0 ? `${item.desconto}%` : '—'}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmt(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totais */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span><span>{fmt(selecionado.subtotal)}</span>
              </div>
              {selecionado.desconto > 0 && (
                <div className="flex justify-between text-sm text-orange-600">
                  <span>Desconto</span><span>−{fmt(selecionado.desconto)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg border-t border-gray-100 pt-2 mt-2">
                <span>Total</span><span className="text-blue-700">{fmt(selecionado.total)}</span>
              </div>
            </div>

            {selecionado.observacao && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-xs text-amber-700 font-medium mb-1">Observação</p>
                <p className="text-sm text-gray-700">{selecionado.observacao}</p>
              </div>
            )}

            {/* Ações */}
            <div className="flex gap-2 flex-wrap">
              {selecionado.status === 'aberto' && (
                <>
                  <button onClick={() => alterarStatus(selecionado.id, 'aprovado')} disabled={atualizando}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg">
                    ✓ Aprovar
                  </button>
                  <button onClick={() => alterarStatus(selecionado.id, 'cancelado')} disabled={atualizando}
                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded-lg">
                    Cancelar
                  </button>
                </>
              )}
              {selecionado.status === 'aprovado' && (
                <button onClick={() => router.push('/pdv')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
                  Converter em venda (PDV)
                </button>
              )}
              {selecionado.status !== 'aberto' && (
                <button onClick={() => alterarStatus(selecionado.id, 'aberto')} disabled={atualizando}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg">
                  Reabrir
                </button>
              )}
              <button onClick={() => excluir(selecionado.id)}
                className="px-4 py-2 border border-red-200 text-red-500 hover:bg-red-50 text-sm font-medium rounded-lg ml-auto">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
