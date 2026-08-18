'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import EnderecoFormModal from './EnderecoFormModal'

type Deposito = { id: string; nome: string; principal: boolean }
type Tipo = { codigo: string; nome: string; cor: string | null }
type Endereco = {
  id: string; deposito_id: string; codigo_interno: string; codigo_legivel: string
  descricao: string | null; tipo: string; status: string; exclusivo: boolean
  zona: string | null; corredor: string | null; estante: string | null
  modulo: string | null; nivel: string | null; posicao: string | null
}

const STATUS_COR: Record<string, string> = {
  ativo: 'bg-emerald-100 text-emerald-700', inativo: 'bg-slate-100 text-slate-500',
  bloqueado: 'bg-red-100 text-red-700', temp_bloqueado: 'bg-amber-100 text-amber-700',
  em_inventario: 'bg-blue-100 text-blue-700', cheio: 'bg-orange-100 text-orange-700', reservado: 'bg-violet-100 text-violet-700',
}

export default function EnderecosClient({ depositos, tipos, depositoIdInicial }: {
  depositos: Deposito[]; tipos: Tipo[]; depositoIdInicial: string
}) {
  const [depositoId, setDepositoId] = useState(depositoIdInicial || depositos.find(d => d.principal)?.id || depositos[0]?.id || '')
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [busca, setBusca] = useState('')
  const [enderecos, setEnderecos] = useState<Endereco[]>([])
  const [carregando, setCarregando] = useState(false)
  const [modal, setModal] = useState<{ endereco: Endereco | null } | null>(null)

  const carregar = useCallback(async () => {
    if (!depositoId) return
    setCarregando(true)
    const sp = new URLSearchParams({ depositoId })
    if (tipoFiltro) sp.set('tipo', tipoFiltro)
    if (statusFiltro) sp.set('status', statusFiltro)
    if (busca) sp.set('busca', busca)
    const r = await fetch(`/api/enderecamento/enderecos?${sp}`).then(r => r.json()).catch(() => null)
    setEnderecos(r?.ok ? r.enderecos : [])
    setCarregando(false)
  }, [depositoId, tipoFiltro, statusFiltro, busca])

  useEffect(() => { carregar() }, [carregar])

  async function excluir(e: Endereco) {
    if (!confirm(`Excluir o endereço ${e.codigo_legivel}?`)) return
    const r = await fetch(`/api/enderecamento/enderecos/${e.id}`, { method: 'DELETE' }).then(r => r.json()).catch(() => ({ ok: false }))
    if (!r.ok) { alert(r.erro ?? 'Erro ao excluir.'); return }
    carregar()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Endereços</h1>
          <p className="text-slate-500 text-sm mt-0.5">{enderecos.length} endereço(s) neste depósito.</p>
        </div>
        <div className="flex gap-2">
          <Link href={depositoId ? `/dashboard/enderecamento/gerador?depositoId=${depositoId}` : '/dashboard/enderecamento/gerador'}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 bg-white">
            Gerador em Lote
          </Link>
          <button onClick={() => setModal({ endereco: null })} disabled={!depositoId}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            + Novo Endereço
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {depositos.length > 0 && (
          <select value={depositoId} onChange={e => setDepositoId(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
            {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        )}
        <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="">Todos os tipos</option>
          {tipos.map(t => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}
        </select>
        <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="">Todos os status</option>
          {Object.keys(STATUS_COR).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar código ou descrição..."
          className="bg-white border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm w-64 focus:outline-none focus:border-blue-400" />
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase">Código</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Descrição</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Tipo</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Status</th>
              <th className="text-center px-3 py-2.5 text-xs font-medium text-slate-500 uppercase">Exclusivo</th>
              <th className="text-right px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {carregando && <tr><td colSpan={6} className="py-8 text-center text-slate-400">Carregando...</td></tr>}
            {!carregando && enderecos.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-400">Nenhum endereço encontrado.</td></tr>}
            {enderecos.map(e => (
              <tr key={e.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2.5 font-mono font-medium text-slate-800">
                  <Link href={`/dashboard/enderecamento/consulta-endereco?codigo=${e.codigo_interno}`} className="hover:text-blue-600 hover:underline">
                    {e.codigo_legivel}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-slate-600">{e.descricao ?? '—'}</td>
                <td className="px-3 py-2.5 text-slate-600">{tipos.find(t => t.codigo === e.tipo)?.nome ?? e.tipo}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COR[e.status] ?? 'bg-slate-100 text-slate-500'}`}>
                    {e.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center">{e.exclusivo ? '✓' : '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => setModal({ endereco: e })} className="text-xs text-blue-600 hover:underline mr-3">Editar</button>
                  <button onClick={() => excluir(e)} className="text-xs text-red-500 hover:underline">Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <EnderecoFormModal depositoId={depositoId} tipos={tipos} endereco={modal.endereco}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); carregar() }} />
      )}
    </div>
  )
}
