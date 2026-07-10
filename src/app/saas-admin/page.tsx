import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function SaasAdminPage() {
  const supabase = await createClient()

  const [{ data: subs }, { data: plans }] = await Promise.all([
    supabase.from('subscriptions').select('status, plan_id, plans(nome, preco_mensal)').limit(1000),
    supabase.from('plans').select('id, nome, codigo, ativo').order('ordem'),
  ])

  const total = subs?.length ?? 0
  const porStatus = (subs ?? []).reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  const mrrEstimado = (subs ?? [])
    .filter(s => s.status === 'active')
    .reduce((sum, s) => {
      const plan = Array.isArray(s.plans) ? s.plans[0] : s.plans as { preco_mensal: number } | null
      return sum + Number(plan?.preco_mensal ?? 0)
    }, 0)

  const KPIs = [
    { label: 'Total de clientes', value: total, icon: '🏢', color: 'bg-blue-50 text-blue-700' },
    { label: 'Em teste grátis', value: porStatus.trial ?? 0, icon: '⏳', color: 'bg-amber-50 text-amber-700' },
    { label: 'Assinaturas ativas', value: porStatus.active ?? 0, icon: '✓', color: 'bg-emerald-50 text-emerald-700' },
    { label: 'Vencidos/Suspensos', value: (porStatus.expired ?? 0) + (porStatus.suspended ?? 0), icon: '⚠', color: 'bg-red-50 text-red-700' },
    { label: 'MRR estimado', value: brl(mrrEstimado), icon: '💰', color: 'bg-violet-50 text-violet-700' },
    { label: 'Planos ativos', value: (plans ?? []).filter(p => p.ativo).length, icon: '📋', color: 'bg-slate-50 text-slate-700' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Visão Geral</h1>
        <p className="text-slate-400 text-sm mt-0.5">Painel de administração do SaaS</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {KPIs.map(k => (
          <div key={k.label} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${k.color}`}>{k.icon}</div>
              <div>
                <p className="text-xs text-slate-400">{k.label}</p>
                <p className="text-xl font-bold text-white mt-0.5">{k.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Distribuição por plano</h2>
        <div className="space-y-2">
          {(plans ?? []).map(plan => {
            const count = (subs ?? []).filter(s => s.plan_id === plan.id).length
            const pct = total > 0 ? Math.round((count / total) * 100) : 0
            return (
              <div key={plan.id} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-24 shrink-0">{plan.nome}</span>
                <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-2 bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-slate-300 w-12 text-right">{count} ({pct}%)</span>
              </div>
            )
          })}
          {total === 0 && <p className="text-sm text-slate-500">Nenhum cliente cadastrado ainda.</p>}
        </div>
      </div>
    </div>
  )
}
