'use client'

import { usePlan } from '@/contexts/PlanContext'
import Link from 'next/link'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  trial:     { label: 'Teste grátis', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: '⏳' },
  active:    { label: 'Ativo',        color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '✓' },
  pending:   { label: 'Pgto pendente', color: 'bg-orange-50 text-orange-700 border-orange-200', icon: '⚠' },
  expired:   { label: 'Vencido',      color: 'bg-red-50 text-red-700 border-red-200', icon: '✗' },
  suspended: { label: 'Suspenso',     color: 'bg-red-50 text-red-700 border-red-200', icon: '🚫' },
  cancelled: { label: 'Cancelado',    color: 'bg-slate-100 text-slate-600 border-slate-200', icon: '✗' },
  blocked:   { label: 'Bloqueado',    color: 'bg-red-50 text-red-700 border-red-200', icon: '🔴' },
}

// Compact banner shown at the bottom of the sidebar
export function PlanBannerSidebar({ collapsed }: { collapsed: boolean }) {
  const plan = usePlan()
  if (plan.isSystemAdmin) {
    if (collapsed) return (
      <div className="px-2 pb-3">
        <div className="w-9 h-9 rounded-lg bg-purple-900 flex items-center justify-center text-purple-300 text-xs font-bold">SA</div>
      </div>
    )
    return (
      <div className="px-3 pb-3">
        <div className="rounded-xl border border-purple-800 bg-purple-900/50 px-3 py-2">
          <p className="text-[10px] text-purple-300 font-semibold uppercase tracking-wider">Admin SaaS</p>
          <p className="text-xs text-purple-200 mt-0.5 font-medium">Acesso total ao sistema</p>
        </div>
      </div>
    )
  }

  const st = STATUS_CONFIG[plan.subscriptionStatus] ?? STATUS_CONFIG.trial
  if (collapsed) return (
    <div className="px-2 pb-3">
      <div title={`${plan.planNome} — ${st.label}`}
        className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
        {st.icon}
      </div>
    </div>
  )

  return (
    <div className="px-3 pb-3">
      <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Plano atual</span>
          <Link href="/upgrade" className="text-[10px] text-blue-400 hover:text-blue-300">Upgrade →</Link>
        </div>
        <p className="text-xs text-white font-semibold">{plan.planNome}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px]">{st.icon}</span>
          <span className="text-[10px] text-slate-300">{st.label}</span>
          {plan.diasRestantes !== null && (
            <span className="text-[10px] text-amber-400 font-medium ml-auto">{plan.diasRestantes}d restantes</span>
          )}
        </div>
      </div>
    </div>
  )
}

// Alert banner shown at top of page for critical subscription issues
export function PlanAlertBanner() {
  const plan = usePlan()
  if (plan.isSystemAdmin) return null

  if (plan.subscriptionStatus === 'expired' || plan.subscriptionStatus === 'blocked' || plan.subscriptionStatus === 'suspended') {
    return (
      <div className="bg-red-600 text-white text-sm px-4 py-2 flex items-center justify-between">
        <span>🚫 Sua assinatura está <strong>{plan.subscriptionStatus === 'expired' ? 'vencida' : 'suspensa'}</strong>. O acesso ao sistema está limitado.</span>
        <Link href="/upgrade" className="ml-4 px-3 py-1 bg-white text-red-600 rounded-lg text-xs font-bold hover:bg-red-50">
          Regularizar →
        </Link>
      </div>
    )
  }

  if (plan.subscriptionStatus === 'trial' && plan.diasRestantes !== null && plan.diasRestantes <= 3) {
    return (
      <div className="bg-amber-500 text-white text-sm px-4 py-2 flex items-center justify-between">
        <span>⏳ Seu período de teste expira em <strong>{plan.diasRestantes} dia(s)</strong>.</span>
        <Link href="/upgrade" className="ml-4 px-3 py-1 bg-white text-amber-600 rounded-lg text-xs font-bold hover:bg-amber-50">
          Assinar agora →
        </Link>
      </div>
    )
  }

  return null
}
