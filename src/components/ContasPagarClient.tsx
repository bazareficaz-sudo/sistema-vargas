'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Conta = {
  id: string; descricao: string; valor: number; vencimento: string
  status: string; data_pagamento: string | null; forma_pagamento: string | null
  parcela: number; total_parcelas: number; observacoes: string | null
  fornecedores: { razao_social: string; nome_fantasia: string | null } | null
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

const STATUS_BADGE: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-700',
  vencido:  'bg-red-100 text-red-600',
  pago:     'bg-green-100 text-green-700',
  cancelado:'bg-gray-100 text-gray-500',
}
const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente', vencido: 'Vencido', pago: 'Pago', cancelado: 'Cancelado',
}

export default function ContasPagarClient({
  contas: inicial, statusFiltro, qInicial, empresaId,
  totalPendente, totalVencido, totalPago,
}: {
  contas: Conta[]; statusFiltro: string; qInicial: string; empresaId: string
  totalPendente: number; totalVencido: number; totalPago: number
}) {
  const router = useRouter()
  const [contas, setContas] = useState(inicial)
  const [q, setQ] = useState(qInicial)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [modalPgto, setModalPgto] = useState<Conta | null>(null)
  const [dataPgto, setDataPgto] = useState(() => new Date().toISOString().split('T')[0])
  const [formaPgto, setFormaPgto] = useState('pix')
  const [salvando, setSalvando] = useState(false)

  function navegar(params: Record<string, string>) {
    const sp = new URLSearchParams({ status: statusFiltro, q, ...params })
    router.push(`/dashboard/contas-pagar?${sp.toString()}`)
  }

  function toggleAll(c: boolean) {
    setSelecionadas(c ? new Set(contas.filter(x => x.status !== 'pago' && x.status !== 'cancelado').map(x => x.id)) : new Set())
  }
  function toggleOne(id: string) {
    setSelecionadas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function registrarPagamento(ids: string[], data: string, forma: string) {
    setSalvando(true)
    const sb = createClient()
    await sb.from('contas_pagar').update({
      status: 'pago', data_pagamento: data, forma_pagamento: forma
    }).in('id', ids)
    setContas(prev => prev.map(c => ids.includes(c.id)
      ? { ...c, status: 'pago', data_pagamento: data, forma_pagamento: forma }
      : c))
    setSelecionadas(new Set())
    setModalPgto(null)
    setSalvando(false)
    router.refresh()
  }

  async function pagarSelecionadas() {
    if (selecionadas.size === 0) return
    await registrarPagamento([...selecionadas], dataPgto, formaPgto)
  }

  async function cancelar(id: string) {
    if (!confirm('Cancelar esta conta?')) return
    const sb = createClient()
    await sb.from('contas_pagar').update({ status: 'cancelado' }).eq('id', id)
    setContas(prev => prev.map(c => c.id === id ? { ...c, status: 'cancelado' } : c))
  }

  const filtradas = contas.filter(c => !q || c.descricao.toLowerCase().includes(q.toLowerCase()))
  const totalFiltrado = filtradas.reduce((s, c) => s + Number(c.valor), 0)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>compras</span><span>›</span>
        <span className="text-gray-600 font-medium">contas a pagar</span>
      </div>
      <h1 className="text-gray-900 text-xl font-semibold mb-5">Contas a Pagar</h1>

      {/* Cards resumo */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">A vencer</p>
          <p className="text-2xl font-bold text-yellow-600">{fmt(totalPendente)}</p>
        </div>
        <div className="bg-white border border-red-100 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Vencido</p>
          <p className="text-2xl font-bold text-red-600">{fmt(totalVencido)}</p>
        </div>
        <div className="bg-white border border-green-100 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Pago (total)</p>
          <p className="text-2xl font-bold text-green-600">{fmt(totalPago)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1">
          {[['pendente','A vencer'], ['vencido','Vencidos'], ['pago','Pagos'], ['todos','Todos']].map(([s, l]) => (
            <button key={s} onClick={() => navegar({ status: s })}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${statusFiltro === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Filtrar por descrição..."
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 bg-white w-64" />
      </div>

      {/* Ações em massa */}
      {selecionadas.size > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-4">
          <span className="text-sm font-medium text-green-700">{selecionadas.size} conta(s) selecionada(s)</span>
          <div className="flex items-center gap-2">
            <input type="date" value={dataPgto} onChange={e => setDataPgto(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none" />
            <select value={formaPgto} onChange={e => setFormaPgto(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none">
              {['pix','boleto','transferência','dinheiro','cartão','cheque'].map(f => (
                <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
              ))}
            </select>
          </div>
          <button onClick={pagarSelecionadas} disabled={salvando}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? '...' : '✓ Registrar pagamento'}
          </button>
          <button onClick={() => setSelecionadas(new Set())} className="ml-auto text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-4 py-3">
                <input type="checkbox"
                  checked={selecionadas.size > 0 && selecionadas.size === filtradas.filter(c => c.status !== 'pago' && c.status !== 'cancelado').length}
                  onChange={e => toggleAll(e.target.checked)}
                  className="w-4 h-4 accent-blue-600" />
              </th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Descrição</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Fornecedor</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Vencimento</th>
              <th className="text-right px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Valor</th>
              <th className="text-center px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Status</th>
              <th className="text-left px-3 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Pagamento</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtradas.map(c => {
              const venc = new Date(c.vencimento + 'T00:00:00')
              const hoje = new Date(); hoje.setHours(0,0,0,0)
              const diasVenc = Math.ceil((venc.getTime() - hoje.getTime()) / 86400000)
              return (
                <tr key={c.id} className={`hover:bg-gray-50 transition-colors group ${c.status === 'vencido' ? 'bg-red-50/30' : ''}`}>
                  <td className="px-4 py-3">
                    {c.status !== 'pago' && c.status !== 'cancelado' && (
                      <input type="checkbox" checked={selecionadas.has(c.id)} onChange={() => toggleOne(c.id)}
                        className="w-4 h-4 accent-blue-600" />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-gray-900 font-medium text-xs">{c.descricao}</p>
                    {c.total_parcelas > 1 && (
                      <p className="text-xs text-gray-400">{c.parcela}/{c.total_parcelas} parcelas</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {c.fornecedores?.nome_fantasia ?? c.fornecedores?.razao_social ?? '—'}
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-xs text-gray-700">{venc.toLocaleDateString('pt-BR')}</p>
                    {c.status === 'pendente' && (
                      <p className={`text-xs ${diasVenc < 0 ? 'text-red-500' : diasVenc <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
                        {diasVenc < 0 ? `${Math.abs(diasVenc)}d atraso` : diasVenc === 0 ? 'Hoje' : `em ${diasVenc}d`}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-gray-900 text-sm">{fmt(Number(c.valor))}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {c.data_pagamento && (
                      <div>
                        <p>{new Date(c.data_pagamento + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                        {c.forma_pagamento && <p className="text-gray-400 capitalize">{c.forma_pagamento}</p>}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {c.status !== 'pago' && c.status !== 'cancelado' && (
                        <button onClick={() => setModalPgto(c)}
                          className="text-xs text-green-600 hover:text-green-800 font-medium">Pagar</button>
                      )}
                      {c.status !== 'cancelado' && c.status !== 'pago' && (
                        <button onClick={() => cancelar(c.id)}
                          className="text-xs text-red-500 hover:text-red-700">Cancelar</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtradas.length === 0 && (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400">Nenhuma conta encontrada.</td></tr>
            )}
          </tbody>
          {filtradas.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={4} className="px-4 py-3 text-xs text-gray-500">{filtradas.length} conta(s)</td>
                <td className="px-3 py-3 text-right text-sm font-bold text-gray-900">{fmt(totalFiltrado)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Modal pagamento individual */}
      {modalPgto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setModalPgto(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-96">
            <h3 className="font-semibold text-gray-900 mb-1">Registrar Pagamento</h3>
            <p className="text-sm text-gray-500 mb-4">{modalPgto.descricao}</p>
            <p className="text-2xl font-bold text-gray-900 mb-5">{fmt(Number(modalPgto.valor))}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Data do pagamento</label>
                <input type="date" value={dataPgto} onChange={e => setDataPgto(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Forma de pagamento</label>
                <select value={formaPgto} onChange={e => setFormaPgto(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  {['pix','boleto','transferência','dinheiro','cartão','cheque'].map(f => (
                    <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setModalPgto(null)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => registrarPagamento([modalPgto.id], dataPgto, formaPgto)} disabled={salvando}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                {salvando ? '...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
