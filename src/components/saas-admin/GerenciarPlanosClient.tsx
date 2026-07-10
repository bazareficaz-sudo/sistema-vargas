'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface PlanLimitFields {
  max_empresas: number; max_usuarios: number; max_produtos: number; max_clientes: number
  max_fornecedores: number; max_depositos: number; max_canais: number
  max_nfce_mes: number; max_nfe_mes: number; max_whatsapp_mes: number
  storage_mb: number; permite_api: boolean; permite_pdv_offline: boolean; permite_suporte_prioritario: boolean
}

interface Plan {
  id: string; nome: string; codigo: string; descricao: string
  preco_mensal: number; preco_anual: number; permite_trial: boolean; dias_trial: number
  exige_pagamento_inicial: boolean; publico: boolean; ativo: boolean; recomendado: boolean
  ordem: number; cor: string
  plan_modules: { modulo: string }[]
  plan_limits: PlanLimitFields | null
}

interface Props {
  plans: Plan[]
  modulos: { key: string; label: string }[]
}

const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const LIMIT_LABELS: Partial<Record<keyof PlanLimitFields, string>> = {
  max_empresas: 'Empresas', max_usuarios: 'Usuários', max_produtos: 'Produtos',
  max_clientes: 'Clientes', max_fornecedores: 'Fornecedores', max_depositos: 'Depósitos',
  max_canais: 'Canais marketplace', max_nfce_mes: 'NFC-e/mês', max_nfe_mes: 'NF-e/mês',
  max_whatsapp_mes: 'WhatsApp/mês', storage_mb: 'Armazenamento (MB)',
}
const BOOL_LIMITS: (keyof PlanLimitFields)[] = ['permite_api', 'permite_pdv_offline', 'permite_suporte_prioritario']
const BOOL_LABELS: Partial<Record<keyof PlanLimitFields, string>> = {
  permite_api: 'Permite API', permite_pdv_offline: 'PDV Offline', permite_suporte_prioritario: 'Suporte prioritário',
}

type ModalMode = 'view' | 'edit' | 'new'

export default function GerenciarPlanosClient({ plans, modulos }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [modal, setModal] = useState<{ mode: ModalMode; plan?: Plan } | null>(null)
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState('')

  // Form state
  const emptyPlan = (): Partial<Plan> => ({
    nome: '', codigo: '', descricao: '', preco_mensal: 0, preco_anual: 0,
    permite_trial: true, dias_trial: 14, exige_pagamento_inicial: false,
    publico: true, ativo: true, recomendado: false, ordem: plans.length + 1, cor: '#3b82f6',
    plan_modules: [],
    plan_limits: {
      max_empresas: 1, max_usuarios: 3, max_produtos: 5000, max_clientes: 1000,
      max_fornecedores: 200, max_depositos: 1, max_canais: 0,
      max_nfce_mes: 500, max_nfe_mes: 0, max_whatsapp_mes: 0,
      storage_mb: 1000, permite_api: false, permite_pdv_offline: false, permite_suporte_prioritario: false,
    },
  })

  const [form, setForm] = useState<Partial<Plan>>(emptyPlan())

  function abrirNovo() { setForm(emptyPlan()); setErro(''); setModal({ mode: 'new' }) }
  function abrirEditar(p: Plan) { setForm({ ...p }); setErro(''); setModal({ mode: 'edit', plan: p }) }

  function toggleModulo(key: string) {
    const atual = form.plan_modules ?? []
    const existe = atual.find(m => m.modulo === key)
    setForm(f => ({
      ...f,
      plan_modules: existe ? atual.filter(m => m.modulo !== key) : [...atual, { modulo: key }],
    }))
  }

  function setLimit<K extends keyof PlanLimitFields>(k: K, v: PlanLimitFields[K]) {
    setForm(f => ({ ...f, plan_limits: { ...f.plan_limits!, [k]: v } }))
  }

  async function salvar() {
    if (!form.nome || !form.codigo) { setErro('Nome e código são obrigatórios'); return }
    setSaving(true); setErro('')
    try {
      const planData = {
        nome: form.nome, codigo: form.codigo, descricao: form.descricao ?? '',
        preco_mensal: form.preco_mensal ?? 0, preco_anual: form.preco_anual ?? 0,
        permite_trial: form.permite_trial ?? true, dias_trial: form.dias_trial ?? 14,
        exige_pagamento_inicial: form.exige_pagamento_inicial ?? false,
        publico: form.publico ?? true, ativo: form.ativo ?? true,
        recomendado: form.recomendado ?? false, ordem: form.ordem ?? 0, cor: form.cor ?? '#3b82f6',
        updated_at: new Date().toISOString(),
      }

      let planId = modal?.plan?.id
      if (modal?.mode === 'new') {
        const { data, error } = await supabase.from('plans').insert(planData).select('id').single()
        if (error) throw error
        planId = data.id
      } else if (planId) {
        const { error } = await supabase.from('plans').update(planData).eq('id', planId)
        if (error) throw error
      }

      if (planId) {
        // Sync modules
        await supabase.from('plan_modules').delete().eq('plan_id', planId)
        const mods = form.plan_modules ?? []
        if (mods.length > 0) {
          await supabase.from('plan_modules').insert(mods.map(m => ({ plan_id: planId, modulo: m.modulo })))
        }
        // Sync limits
        if (form.plan_limits) {
          await supabase.from('plan_limits').upsert({ plan_id: planId, ...form.plan_limits })
        }
      }

      setModal(null)
      router.refresh()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar plano')
    } finally {
      setSaving(false)
    }
  }

  async function toggleAtivo(p: Plan) {
    await supabase.from('plans').update({ ativo: !p.ativo }).eq('id', p.id)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Planos</h1>
          <p className="text-slate-400 text-sm">{plans.length} plano(s) cadastrado(s)</p>
        </div>
        <button onClick={abrirNovo}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold">
          + Novo plano
        </button>
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-3 gap-4">
        {plans.map(p => {
          const mods = p.plan_modules?.map(m => m.modulo) ?? []
          return (
            <div key={p.id} className={`bg-slate-900 border rounded-2xl p-5 ${p.ativo ? 'border-slate-700' : 'border-slate-800 opacity-60'}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: p.cor }} />
                    <h3 className="font-bold text-white">{p.nome}</h3>
                    {p.recomendado && <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full">★ Destaque</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{p.codigo}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => abrirEditar(p)}
                    className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg">
                    ✏ Editar
                  </button>
                  <button onClick={() => toggleAtivo(p)}
                    className={`text-xs px-2 py-1 rounded-lg ${p.ativo ? 'bg-red-900/50 text-red-400 hover:bg-red-900' : 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900'}`}>
                    {p.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              </div>
              <div className="text-2xl font-bold text-white">{brl(p.preco_mensal)}<span className="text-sm font-normal text-slate-400">/mês</span></div>
              <div className="mt-3 flex flex-wrap gap-1">
                {mods.slice(0, 8).map(m => (
                  <span key={m} className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded-md">{m}</span>
                ))}
                {mods.length > 8 && <span className="text-[10px] text-slate-500">+{mods.length - 8}</span>}
              </div>
              <div className="mt-3 text-xs text-slate-500">
                {p.permite_trial ? `${p.dias_trial} dias grátis` : 'Sem período de teste'}
                {' · '}
                {p.publico ? 'Público' : 'Privado'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 py-8">
          <div className="bg-slate-900 rounded-2xl border border-slate-700 w-[800px] max-w-full mx-4">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-white">{modal.mode === 'new' ? 'Novo plano' : `Editar: ${modal.plan?.nome}`}</h2>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              {/* Basic info */}
              <section>
                <h3 className="text-xs font-semibold text-slate-400 uppercase mb-3">Informações básicas</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[['nome','Nome do plano'],['codigo','Código interno'],['descricao','Descrição'],['cor','Cor (hex)']].map(([f,l]) => (
                    <div key={f} className={f === 'descricao' ? 'col-span-2' : ''}>
                      <label className="text-xs text-slate-400">{l}</label>
                      <input value={String(form[f as keyof Plan] ?? '')} onChange={e => setForm(x => ({ ...x, [f]: e.target.value }))}
                        className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500" />
                    </div>
                  ))}
                  {[['preco_mensal','Preço mensal (R$)'],['preco_anual','Preço anual (R$)'],['dias_trial','Dias de trial'],['ordem','Ordem']].map(([f,l]) => (
                    <div key={f}>
                      <label className="text-xs text-slate-400">{l}</label>
                      <input type="number" value={Number(form[f as keyof Plan] ?? 0)}
                        onChange={e => setForm(x => ({ ...x, [f]: Number(e.target.value) }))}
                        className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-4">
                  {[['permite_trial','Permite trial'],['exige_pagamento_inicial','Exige pagamento'],['publico','Público'],['ativo','Ativo'],['recomendado','Destaque']].map(([f,l]) => (
                    <label key={f} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={Boolean(form[f as keyof Plan])}
                        onChange={e => setForm(x => ({ ...x, [f]: e.target.checked }))}
                        className="accent-blue-500" />
                      {l}
                    </label>
                  ))}
                </div>
              </section>

              {/* Modules */}
              <section>
                <h3 className="text-xs font-semibold text-slate-400 uppercase mb-3">Módulos disponíveis ({(form.plan_modules ?? []).length} selecionados)</h3>
                <div className="grid grid-cols-3 gap-2">
                  {modulos.map(m => {
                    const ativo = !!(form.plan_modules ?? []).find(x => x.modulo === m.key)
                    return (
                      <label key={m.key} onClick={() => toggleModulo(m.key)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors ${ativo ? 'bg-blue-900/40 border-blue-600 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                        <div className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${ativo ? 'bg-blue-500 border-blue-500' : 'border-slate-600'}`}>
                          {ativo && <span className="text-white text-[8px]">✓</span>}
                        </div>
                        {m.label}
                      </label>
                    )
                  })}
                </div>
              </section>

              {/* Limits */}
              <section>
                <h3 className="text-xs font-semibold text-slate-400 uppercase mb-3">Limites quantitativos <span className="text-slate-600 normal-case font-normal">(-1 = ilimitado)</span></h3>
                <div className="grid grid-cols-3 gap-3">
                  {(Object.entries(LIMIT_LABELS) as [keyof PlanLimitFields, string][]).map(([k, l]) => (
                    <div key={k}>
                      <label className="text-xs text-slate-400">{l}</label>
                      <input type="number" value={Number(form.plan_limits?.[k] ?? 0)}
                        onChange={e => setLimit(k, Number(e.target.value) as PlanLimitFields[typeof k])}
                        className="mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500" />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-6">
                  {BOOL_LIMITS.map(k => (
                    <label key={k} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input type="checkbox"
                        checked={Boolean(form.plan_limits?.[k])}
                        onChange={e => setLimit(k, e.target.checked as PlanLimitFields[typeof k])}
                        className="accent-blue-500" />
                      {BOOL_LABELS[k]}
                    </label>
                  ))}
                </div>
              </section>

              {erro && <p className="text-red-400 text-sm">{erro}</p>}
            </div>

            <div className="px-6 py-4 border-t border-slate-800 flex justify-end gap-3">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancelar</button>
              <button onClick={salvar} disabled={saving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar plano'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
