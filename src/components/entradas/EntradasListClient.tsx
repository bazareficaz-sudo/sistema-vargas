'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

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
function fmtData(d: string | null | undefined) {
  if (!d) return '—'
  // data_entrada é TIMESTAMPTZ (já vem com hora/timezone) — só datas puras
  // "YYYY-MM-DD" (10 chars, ex: data_emissao) precisam do T00:00:00 anexado.
  const date = d.length <= 10 ? new Date(d + 'T00:00:00') : new Date(d)
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR')
}

export default function EntradasListClient({
  entradas: inicial,
  fornecedores,
  pendencias,
}: {
  entradas: Entrada[]
  fornecedores: Fornecedor[]
  pendencias: { semRevisao: number; semContas: number; rascunho: number }
}) {
  const [lista, setLista] = useState<Entrada[]>(inicial)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroRevisao, setFiltroRevisao] = useState('')
  const [filtroForn, setFiltroForn] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [confirmando, setConfirmando] = useState<Entrada | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

  async function excluirEntrada(entrada: Entrada) {
    setExcluindo(true)
    setErroExclusao('')
    const supabase = createClient()
    try {
      if (entrada.status === 'confirmada') {
        // Reverte estoque: busca itens e decrementa quantidade
        const { data: itens } = await supabase
          .from('entrada_itens')
          .select('produto_id, quantidade')
          .eq('entrada_id', entrada.id)
        if (itens && itens.length > 0) {
          for (const item of itens) {
            const { data: prod } = await supabase
              .from('produtos')
              .select('quantidade_estoque')
              .eq('id', item.produto_id)
              .single()
            if (prod) {
              await supabase
                .from('produtos')
                .update({ quantidade_estoque: Math.max(0, (prod.quantidade_estoque ?? 0) - item.quantidade) })
                .eq('id', item.produto_id)
            }
          }
        }
        // Remove contas a pagar vinculadas
        await supabase.from('contas_pagar').delete().eq('entrada_id', entrada.id)
      }
      // Remove itens e a entrada (cascade via FK ou explícito)
      await supabase.from('entrada_itens').delete().eq('entrada_id', entrada.id)
      const { error } = await supabase.from('entradas').delete().eq('id', entrada.id)
      if (error) throw error
      setLista(prev => prev.filter(e => e.id !== entrada.id))
      setConfirmando(null)
    } catch (e: any) {
      setErroExclusao(e.message ?? 'Erro ao excluir')
    } finally {
      setExcluindo(false)
    }
  }

  const filtradas = useMemo(() => {
    const q = busca.toLowerCase().trim()
    return lista.filter(e => {
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
  }, [lista, busca, filtroStatus, filtroRevisao, filtroForn, dataInicio, dataFim])

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
          <p className="text-gray-500 text-sm mt-0.5">{filtradas.length} de {lista.length} entradas</p>
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
                    {fmtData(e.data_entrada)}
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
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-3">
                      <Link
                        href={e.status === 'rascunho' ? `/dashboard/entradas/nova?rascunho=${e.id}` : `/dashboard/entradas/${e.id}`}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
                        {e.status === 'rascunho' ? 'Continuar →' : 'Abrir →'}
                      </Link>
                      {e.status !== 'cancelada' && (
                        <button
                          onClick={() => { setErroExclusao(''); setConfirmando(e) }}
                          title="Excluir entrada"
                          className="text-red-400 hover:text-red-600 text-sm transition-colors">
                          🗑
                        </button>
                      )}
                    </div>
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

      {/* Modal de confirmação de exclusão */}
      {confirmando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Excluir entrada?</h2>
            <p className="text-sm text-gray-500 mb-4">
              {confirmando.numero_entrada ?? 'Rascunho'} —{' '}
              {confirmando.fornecedores?.nome_fantasia ?? confirmando.fornecedores?.razao_social ?? 'Fornecedor não informado'}
            </p>

            {confirmando.status === 'confirmada' ? (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-700">
                <p className="font-semibold mb-1">⚠️ Atenção — entrada confirmada</p>
                <ul className="list-disc list-inside space-y-0.5 text-xs">
                  <li>O estoque dos produtos será revertido</li>
                  <li>As contas a pagar vinculadas serão removidas</li>
                  <li>Esta ação não pode ser desfeita</li>
                </ul>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 mb-4 text-sm text-yellow-700">
                <p className="text-xs">O rascunho será excluído permanentemente.</p>
              </div>
            )}

            {erroExclusao && (
              <p className="text-xs text-red-600 mb-3">Erro: {erroExclusao}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setConfirmando(null); setErroExclusao('') }}
                disabled={excluindo}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={() => excluirEntrada(confirmando)}
                disabled={excluindo}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50">
                {excluindo ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
