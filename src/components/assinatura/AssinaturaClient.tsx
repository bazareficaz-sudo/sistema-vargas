'use client'

import { useState } from 'react'
import { SYSTEM_MODULES, type ModuloKey } from '@/lib/plans/modules'

type Props = {
  plano: { nome: string; codigo: string; cor: string; precoMensal: number; exigePagamentoInicial: boolean; modulos: string[] }
  status: string
  trialFim: string | null
  diasRestantes: number | null
  cobranca: { proximoVencimento: string | null; ultimoValorCobrado: number | null; ultimaCobrancaEm: string | null } | null
  pagamentos: { id: number; data: string; valor: number; status: string; statusPagamento: string | null }[]
}

const STATUS_INFO: Record<string, { label: string; color: string; icon: string }> = {
  trial:     { label: 'Em período de teste', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: '⏳' },
  active:    { label: 'Ativa',               color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '✓' },
  pending:   { label: 'Pagamento pendente',  color: 'bg-orange-50 text-orange-700 border-orange-200', icon: '⚠' },
  expired:   { label: 'Vencida',             color: 'bg-red-50 text-red-700 border-red-200', icon: '✗' },
  suspended: { label: 'Suspensa',            color: 'bg-red-50 text-red-700 border-red-200', icon: '🚫' },
  cancelled: { label: 'Cancelada',           color: 'bg-slate-100 text-slate-600 border-slate-200', icon: '✗' },
  blocked:   { label: 'Bloqueada',           color: 'bg-red-50 text-red-700 border-red-200', icon: '🔴' },
}

const PAGAMENTO_STATUS: Record<string, { label: string; color: string }> = {
  approved:  { label: 'Pago',      color: 'text-emerald-600' },
  pending:   { label: 'Pendente',  color: 'text-amber-600' },
  rejected:  { label: 'Recusado',  color: 'text-red-600' },
  cancelled: { label: 'Cancelado', color: 'text-slate-500' },
}

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtData(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

export default function AssinaturaClient({ plano, status, diasRestantes, cobranca, pagamentos }: Props) {
  const [processando, setProcessando] = useState(false)
  const st = STATUS_INFO[status] ?? STATUS_INFO.trial
  const precisaAcao = ['pending', 'expired', 'suspended', 'blocked'].includes(status)

  async function concluirPagamento() {
    setProcessando(true)
    try {
      const confRes = await fetch('/api/mercadopago/confirmar-assinatura', { method: 'POST' })
      const confData = await confRes.json()
      if (confData.ok && confData.status === 'active') {
        window.location.reload()
        return
      }
      const res = await fetch('/api/mercadopago/criar-assinatura', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) { alert(data.error ?? 'Erro ao iniciar o pagamento.'); return }
      window.location.href = data.init_point
    } finally {
      setProcessando(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Minha Assinatura</h1>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Plano atual</p>
            <p className="text-lg font-bold text-slate-900">{plano.nome}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${st.color}`}>
            {st.icon} {st.label}
          </span>
        </div>

        <div className="flex items-baseline gap-1 mb-4">
          <span className="text-2xl font-bold text-slate-900">{fmtBRL(plano.precoMensal)}</span>
          <span className="text-sm text-slate-400">/mês</span>
        </div>

        {status === 'trial' && diasRestantes !== null && (
          <p className="text-sm text-amber-600 mb-3">⏳ {diasRestantes} dia(s) restantes de teste grátis.</p>
        )}

        {cobranca?.proximoVencimento && (
          <p className="text-sm text-slate-500 mb-1">Próxima cobrança: <strong>{fmtData(cobranca.proximoVencimento)}</strong></p>
        )}
        {cobranca?.ultimaCobrancaEm && (
          <p className="text-sm text-slate-500 mb-3">
            Última cobrança: {fmtData(cobranca.ultimaCobrancaEm)} — {fmtBRL(cobranca.ultimoValorCobrado ?? 0)}
          </p>
        )}

        {precisaAcao && (
          <button onClick={concluirPagamento} disabled={processando}
            className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl disabled:opacity-60">
            {processando ? 'Verificando...' : status === 'pending' ? 'Concluir pagamento →' : 'Regularizar pagamento →'}
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">Recursos incluídos</p>
        <div className="flex flex-wrap gap-2">
          {plano.modulos.length === 0 && <p className="text-sm text-slate-400">Nenhum módulo liberado.</p>}
          {plano.modulos.map(m => (
            <span key={m} className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
              {SYSTEM_MODULES[m as ModuloKey]?.label ?? m}
            </span>
          ))}
        </div>
      </div>

      {pagamentos.length > 0 && (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider px-5 pt-4 pb-2">Faturas</p>
          <table className="w-full text-sm">
            <thead><tr className="text-slate-500 text-xs border-y border-slate-100 bg-slate-50">
              <th className="px-5 py-2 text-left">Data</th>
              <th className="px-5 py-2 text-right">Valor</th>
              <th className="px-5 py-2 text-right">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {pagamentos.map(p => {
                const ps = PAGAMENTO_STATUS[p.statusPagamento ?? ''] ?? { label: p.statusPagamento ?? p.status, color: 'text-slate-500' }
                return (
                  <tr key={p.id}>
                    <td className="px-5 py-2.5 text-slate-700">{fmtData(p.data)}</td>
                    <td className="px-5 py-2.5 text-right text-slate-700">{fmtBRL(p.valor)}</td>
                    <td className={`px-5 py-2.5 text-right font-medium ${ps.color}`}>{ps.label}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
