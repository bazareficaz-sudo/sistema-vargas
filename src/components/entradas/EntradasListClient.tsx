'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

type Entrada = {
  id: string
  numero_entrada: string | null
  numero_nf: string | null
  serie: string | null
  data_emissao: string | null
  data_entrada: string
  valor_total: number
  status: string
  status_revisao: string | null
  created_at: string
  fornecedores: { razao_social: string; nome_fantasia: string | null } | null
  qtd_itens?: number
  total_contas?: number
}

type Fornecedor = { id: string; razao_social: string; nome_fantasia: string | null }

const STATUS_CLS: Record<string, string> = {
  confirmada: 'bg-green-100 text-green-700',
  cancelada:  'bg-red-100 text-red-600',
  rascunho:   'bg-yellow-100 text-yellow-700',
}
const STATUS_LABEL: Record<string, string> = {
  confirmada: 'Confirmada',
  cancelada:  'Cancelada',
  rascunho:   'Rascunho',
}
const REVISAO_CLS: Record<string, string> = {
  revisado:   'bg-emerald-50 text-emerald-600 border border-emerald-100',
  pendente:   'bg-orange-50 text-orange-600 border border-orange-100',
  em_revisao: 'bg-blue-50 text-blue-600 border border-blue-100',
  dispensado: 'bg-gray-100 text-gray-500 border border-gray-200',
}
const REVISAO_LABEL: Record<string, string> = {
  revisado:   '✓ Revisado',
  pendente:   '⏳ Preços pendentes',
  em_revisao: '✎ Em revisão',
  dispensado: '— Dispensado',
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

export default function EntradasListClient({
  entradas: inicial,
  fornecedores,
  pendencias,
}: {
  entradas: Entrada[]
  fornecedores: Fornecedor[]
  pendencias: { semRevisao: number; semContas: number; rascunho: number }
}) {
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroRevisao, setFiltroRevisao] = useState('')
  const [filtroForn, setFiltroForn] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  const filtradas = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return inicial.filter(e => {
      if (filtroStatus && e.status !== filtroStatus) return false
      if (filtroRevisao && (e.status_revisao ?? 'pendente') !== filtroRevisao) return false
      if (filtroForn && e.fornecedores && !(e.fornecedores.razao_social + (e.fornecedores.nome_fantasia ?? '')).toLowerCase().includes(filtroForn.toLowerCase())) return false
      if (dataInicio && e.data_entrada < dataInicio) return false
      if (dataFim && e.data_entrada > dataFim) return false
      if (q) {
        const hay = [e.numero_entrada, e.numero_nf, e.fornecedores?.razao_social, e.fornecedores?.nome_fantasia].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [inicial, busca, filtroStatus, filtroRevisao, filtroForn, dataInicio, dataFim])

  const temFiltro = busca || filtroStatus || filtroRevisao || filtroForn || dataInicio || dataFim
  function limpar() { setBusca(''); setFiltroStatus(''); setFiltroRevisao(''); setFiltroForn(''); setDataInicio(''); setDataFim('') }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>compras</span><span>›</span>
        <span className="text-gray-600 font-medium">entradas</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Entradas de Mercadoria</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtradas.length} de {inicial.length} entradas</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/entradas/produtos"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
            📦 Produtos Comprados
          </Link>
          <Link href="/dashboard/entradas/nova"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Nova entrada
          </Link>
        </div>
      </div>

      {/* Painel de pendências */}
      {(pendencias.semRevisao > 0 || pendencias.semContas > 0 || pendencias.rascunho > 0) && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {pendencias.rascunho > 0 && (
            <button onClick={() => setFiltroStatus('rascunho')}
              className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-left hover:bg-yellow-100 transition-colors">
              <span className="text-xl">📝</span>
              <div>
                <p className="text-sm font-semibold text-yellow-800">{pendencias.rascunho}</p>
                <p className="text-xs text-yellow-600">Rascunhos não finalizados</p>
              </div>
            </button>
          )}
          {pendencias.semRevisao > 0 && (
            <button onClick={() => setFiltroRevisao('pendente')}
              className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-left hover:bg-orange-100 transition-colors">
              <span className="text-xl">💰</span>
              <div>
                <p className="text-sm font-semibold text-orange-800">{pendencias.semRevisao}</p>
                <p className="text-xs text-orange-600">Preços pendentes de revisão</p>
              </div>
            </button>
          )}
          {pendencias.semContas > 0 && (
            <button onClick={() => { setFiltroStatus('confirmada'); setFiltroRevisao('') }}
              className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-left hover:bg-red-100 transition-colors">
              <span className="text-xl">💸</span>
              <div>
                <p className="text-sm font-semibold text-red-800">{pendencias.semContas}</p>
                <p className="text-xs text-red-600">Sem contas a pagar geradas</p>
              </div>
            </button>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-gray-500 mb-1">Buscar (nº entrada, NF, fornecedor)</label>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="ENT-000001, 12345..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
            <option value="">Todos</option>
            <option value="rascunho">Rascunho</option>
            <option value="confirmada">Confirmada</option>
            <option value="cancelada">Cancelada</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Revisão de preços</label>
          <select value={filtroRevisao} onChange={e => setFiltroRevisao(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="em_revisao">Em revisão</option>
            <option value="revisado">Revisado</option>
            <option value="dispensado">Dispensado</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Data início</label>
          <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Data fim</label>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </div>
        {temFiltro && (
          <button onClick={limpar} className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
            ✕ Limpar
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nº Entrada</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nº NF</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Fornecedor</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Itens</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Data entrada</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Total</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Preços</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtradas.map(e => {
              const revisao = e.status_revisao ?? 'pendente'
              return (
                <tr key={e.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded">
                      {e.numero_entrada ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-500 text-xs">{e.numero_nf ?? '—'}{e.serie ? `/${e.serie}` : ''}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900 font-medium text-sm">
                      {e.fornecedores?.nome_fantasia ?? e.fornecedores?.razao_social ?? '—'}
                    </p>
                    {e.fornecedores?.nome_fantasia && (
                      <p className="text-xs text-gray-400">{e.fornecedores.razao_social}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs text-gray-500">{e.qtd_itens ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {e.data_entrada ? new Date(e.data_entrada + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {fmt(Number(e.valor_total))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLS[e.status] ?? STATUS_CLS.rascunho}`}>
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.status === 'confirmada' && (
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${REVISAO_CLS[revisao] ?? REVISAO_CLS.pendente}`}>
                        {REVISAO_LABEL[revisao] ?? revisao}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={e.status === 'rascunho' ? `/dashboard/entradas/nova?rascunho=${e.id}` : `/dashboard/entradas/${e.id}`}
                      className="opacity-0 group-hover:opacity-100 text-xs text-blue-600 hover:text-blue-800 transition-opacity font-medium whitespace-nowrap">
                      {e.status === 'rascunho' ? 'Continuar →' : 'Abrir →'}
                    </Link>
                  </td>
                </tr>
              )
            })}
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-400">
                  {temFiltro ? 'Nenhuma entrada encontrada com esses filtros.' : (
                    <>Nenhuma entrada registrada. <Link href="/dashboard/entradas/nova" className="text-blue-600 hover:underline">Criar primeira entrada</Link></>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
