'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Status = 'trial' | 'active' | 'pending' | 'expired' | 'suspended' | 'cancelled' | 'blocked'

interface Cliente {
  id: string; empresa_id: string; empresa_nome: string
  plan_id: string; plan_nome: string; plan_cor: string
  status: string; data_inicio: string; trial_fim: string | null
  data_fim: string | null; diasRestantes: number | null
  plano_personalizado: boolean; created_at: string
}

interface Plan { id: string; nome: string; codigo: string }

interface Props { clientes: Cliente[]; plans: Plan[] }

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  trial:     { label: 'Teste grátis', color: 'bg-amber-100 text-amber-700' },
  active:    { label: 'Ativo',        color: 'bg-emerald-100 text-emerald-700' },
  pending:   { label: 'Pgto pendente', color: 'bg-orange-100 text-orange-700' },
  expired:   { label: 'Vencido',      color: 'bg-red-100 text-red-700' },
  suspended: { label: 'Suspenso',     color: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelado',    color: 'bg-slate-200 text-slate-600' },
  blocked:   { label: 'Bloqueado',    color: 'bg-red-200 text-red-800' },
}

export default function ClientesAdminClient({ clientes, plans }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [modal, setModal] = useState<Cliente | null>(null)
  const [editStatus, setEditStatus] = useState<Status>('active')
  const [editPlanId, setEditPlanId] = useState('')
  const [editObs, setEditObs] = useState('')
  const [editDias, setEditDias] = useState(0)
  const [saving, setSaving] = useState(false)

  const [modalSuporte, setModalSuporte] = useState<Cliente | null>(null)
  const [motivoSuporte, setMotivoSuporte] = useState('')
  const [iniciandoSuporte, setIniciandoSuporte] = useState(false)
  const [erroSuporte, setErroSuporte] = useState('')

  async function iniciarSuporte() {
    if (!modalSuporte) return
    if (motivoSuporte.trim().length < 10) { setErroSuporte('Descreva o motivo (mínimo 10 caracteres).'); return }
    setIniciandoSuporte(true)
    setErroSuporte('')
    const res = await fetch('/api/saas-admin/suporte/iniciar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresaId: modalSuporte.empresa_id, motivo: motivoSuporte }),
    })
    const data = await res.json()
    setIniciandoSuporte(false)
    if (!data.ok) { setErroSuporte(data.erro ?? 'Erro ao iniciar suporte'); return }
    window.open(`/suporte/entrar?token_hash=${encodeURIComponent(data.tokenHash)}`, '_blank')
    setModalSuporte(null)
    setMotivoSuporte('')
  }

  const filtrados = clientes.filter(c => {
    if (busca && !c.empresa_nome.toLowerCase().includes(busca.toLowerCase())) return false
    if (filtroStatus && c.status !== filtroStatus) return false
    return true
  })

  function abrirModal(c: Cliente) {
    setModal(c)
    setEditStatus(c.status as Status)
    setEditPlanId(c.plan_id)
    setEditObs('')
    setEditDias(0)
  }

  async function salvarAlteracao() {
    if (!modal) return
    setSaving(true)
    try {
      const updateData: Record<string, unknown> = {
        status: editStatus,
        plan_id: editPlanId,
        updated_at: new Date().toISOString(),
      }
      if (editDias > 0 && editStatus === 'trial') {
        const novaData = new Date()
        novaData.setDate(novaData.getDate() + editDias)
        updateData.trial_fim = novaData.toISOString().slice(0, 10)
      }
      await supabase.from('subscriptions').update(updateData).eq('id', modal.id)

      // Log history
      await supabase.from('subscription_history').insert({
        empresa_id: modal.empresa_id,
        plan_id: editPlanId,
        subscription_id: modal.id,
        evento: editStatus !== modal.status ? 'status_alterado' : 'plano_alterado',
        status_anterior: modal.status,
        status_novo: editStatus,
        plano_anterior: modal.plan_nome,
        plano_novo: plans.find(p => p.id === editPlanId)?.nome ?? '',
        observacao: editObs || null,
      })

      setModal(null)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function acao(c: Cliente, novoStatus: Status) {
    await supabase.from('subscriptions').update({ status: novoStatus, updated_at: new Date().toISOString() }).eq('id', c.id)
    await supabase.from('subscription_history').insert({
      empresa_id: c.empresa_id, subscription_id: c.id,
      evento: novoStatus, status_anterior: c.status, status_novo: novoStatus,
    })
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clientes</h1>
          <p className="text-slate-400 text-sm">{clientes.length} cliente(s) cadastrado(s)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar empresa..."
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 w-56" />
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white">
          <option value="">Todos os status</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 border-b border-slate-700">
            <tr>
              {['Empresa', 'Plano', 'Status', 'Cadastro', 'Trial/Venc.', 'Dias rest.', 'Ações'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtrados.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">Nenhum cliente encontrado</td></tr>
            ) : filtrados.map(c => {
              const st = STATUS_CFG[c.status] ?? STATUS_CFG.trial
              return (
                <tr key={c.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{c.empresa_nome}</p>
                    {c.plano_personalizado && <span className="text-[10px] text-purple-400">✦ Plano personalizado</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: c.plan_cor }} />
                      <span className="text-slate-300 text-xs">{c.plan_nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.color}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {c.status === 'trial' && c.trial_fim
                      ? new Date(c.trial_fim).toLocaleDateString('pt-BR')
                      : c.data_fim
                        ? new Date(c.data_fim).toLocaleDateString('pt-BR')
                        : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.diasRestantes !== null
                      ? <span className={c.diasRestantes <= 3 ? 'text-red-400 font-bold' : 'text-slate-300'}>{c.diasRestantes}d</span>
                      : <span className="text-slate-500">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => abrirModal(c)}
                        className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg">
                        ✏ Gerir
                      </button>
                      <button onClick={() => { setModalSuporte(c); setMotivoSuporte(''); setErroSuporte('') }}
                        className="text-xs px-2 py-1 bg-purple-900/50 hover:bg-purple-900 text-purple-300 rounded-lg">
                        🛟 Suporte
                      </button>
                      {c.status !== 'suspended' && c.status !== 'blocked' && (
                        <button onClick={() => acao(c, 'suspended')}
                          className="text-xs px-2 py-1 bg-red-900/50 hover:bg-red-900 text-red-400 rounded-lg">
                          Suspender
                        </button>
                      )}
                      {(c.status === 'suspended' || c.status === 'blocked') && (
                        <button onClick={() => acao(c, 'active')}
                          className="text-xs px-2 py-1 bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 rounded-lg">
                          Reativar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-[480px] p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold text-white">{modal.empresa_nome}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Gerenciar assinatura</p>
              </div>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div>
              <label className="text-xs text-slate-400">Status da assinatura</label>
              <select value={editStatus} onChange={e => setEditStatus(e.target.value as Status)}
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                {Object.entries(STATUS_CFG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400">Plano</label>
              <select value={editPlanId} onChange={e => setEditPlanId(e.target.value)}
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white">
                {plans.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>

            {editStatus === 'trial' && (
              <div>
                <label className="text-xs text-slate-400">Prorrogar trial (dias adicionais)</label>
                <input type="number" value={editDias} onChange={e => setEditDias(Number(e.target.value))} min={0}
                  className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
              </div>
            )}

            <div>
              <label className="text-xs text-slate-400">Observação (log)</label>
              <input value={editObs} onChange={e => setEditObs(e.target.value)}
                placeholder="Motivo da alteração..."
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setModal(null)} className="flex-1 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-xl">
                Cancelar
              </button>
              <button onClick={salvarAlteracao} disabled={saving}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de acesso de suporte */}
      {modalSuporte && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-slate-900 border border-purple-900/60 rounded-2xl w-[480px] p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold text-white">🛟 Acessar como suporte</h2>
                <p className="text-xs text-slate-400 mt-0.5">{modalSuporte.empresa_nome}</p>
              </div>
              <button onClick={() => setModalSuporte(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <p className="text-xs text-slate-400">
              Abre uma sessão temporária (2h) logada como o administrador dessa empresa. Fica registrada em
              auditoria e o cliente vê um aviso ao logar de novo.
            </p>
            <p className="text-xs text-amber-400 bg-amber-950/40 border border-amber-900/60 rounded-lg px-3 py-2">
              ⚠ Isso troca a sessão de login do <strong>navegador inteiro</strong> (abas compartilham login) —
              use uma janela anônima/privada se quiser manter seu acesso de admin aberto ao mesmo tempo.
            </p>

            <div>
              <label className="text-xs text-slate-400">Motivo do acesso *</label>
              <textarea value={motivoSuporte} onChange={e => setMotivoSuporte(e.target.value)} rows={3}
                placeholder="Ex: cliente pediu ajuda pra configurar o fiscal via ticket #123"
                className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
            </div>

            {erroSuporte && <p className="text-xs text-red-400">{erroSuporte}</p>}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setModalSuporte(null)} className="flex-1 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-xl">
                Cancelar
              </button>
              <button onClick={iniciarSuporte} disabled={iniciandoSuporte}
                className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {iniciandoSuporte ? 'Gerando acesso...' : 'Iniciar suporte'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
