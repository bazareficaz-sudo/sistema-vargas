import { createClient } from '@/lib/supabase/server'
import type { PlanData, PlanLimits, SubscriptionStatus } from './types'
import { DEFAULT_LIMITS } from './types'

// Loads complete plan data for the current user's empresa.
// Returns null if user is not authenticated.
export async function loadPlanData(empresaId: string, userId: string): Promise<PlanData> {
  const supabase = await createClient()

  // Check if user is a system admin
  const { data: adminRow } = await supabase
    .from('system_admins')
    .select('id, nivel')
    .eq('id', userId)
    .eq('ativo', true)
    .single()

  const isSystemAdmin = !!adminRow

  // Load subscription + plan + modules + limits in parallel
  const [subResult, adminModulos] = await Promise.all([
    supabase
      .from('subscriptions')
      .select(`
        id, status, trial_fim, data_fim,
        plans!inner(id, nome, codigo, cor,
          plan_modules(modulo),
          plan_limits(*)
        )
      `)
      .eq('empresa_id', empresaId)
      .single(),
    Promise.resolve(null),
  ])

  const sub = subResult.data

  if (!sub) {
    // No subscription yet — default to starter trial with basic modules
    return {
      planId: '',
      planNome: isSystemAdmin ? 'Admin SaaS' : 'Sem plano',
      planCodigo: isSystemAdmin ? 'saas_admin' : 'none',
      planCor: '#64748b',
      subscriptionId: '',
      subscriptionStatus: isSystemAdmin ? 'active' : 'trial',
      trialFim: null,
      diasRestantes: null,
      modulos: isSystemAdmin ? ['*'] : ['dashboard', 'produtos', 'clientes', 'vendas', 'relatorios'],
      limites: DEFAULT_LIMITS,
      isSystemAdmin,
      empresaId,
      role: null,
      suporte: null,
    }
  }

  const plan = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans as Record<string, unknown>
  const rawModulos = (plan?.plan_modules as { modulo: string }[] | null) ?? []
  const modulos = rawModulos.map(m => m.modulo)
  const rawLimits = Array.isArray(plan?.plan_limits) ? plan.plan_limits[0] : plan?.plan_limits
  const limites: PlanLimits = rawLimits ? {
    max_empresas: rawLimits.max_empresas ?? DEFAULT_LIMITS.max_empresas,
    max_usuarios: rawLimits.max_usuarios ?? DEFAULT_LIMITS.max_usuarios,
    max_produtos: rawLimits.max_produtos ?? DEFAULT_LIMITS.max_produtos,
    max_clientes: rawLimits.max_clientes ?? DEFAULT_LIMITS.max_clientes,
    max_fornecedores: rawLimits.max_fornecedores ?? DEFAULT_LIMITS.max_fornecedores,
    max_depositos: rawLimits.max_depositos ?? DEFAULT_LIMITS.max_depositos,
    max_canais: rawLimits.max_canais ?? DEFAULT_LIMITS.max_canais,
    max_vendas_mes: rawLimits.max_vendas_mes ?? DEFAULT_LIMITS.max_vendas_mes,
    max_nfce_mes: rawLimits.max_nfce_mes ?? DEFAULT_LIMITS.max_nfce_mes,
    max_nfe_mes: rawLimits.max_nfe_mes ?? DEFAULT_LIMITS.max_nfe_mes,
    max_whatsapp_mes: rawLimits.max_whatsapp_mes ?? DEFAULT_LIMITS.max_whatsapp_mes,
    storage_mb: rawLimits.storage_mb ?? DEFAULT_LIMITS.storage_mb,
    permite_api: rawLimits.permite_api ?? false,
    permite_pdv_offline: rawLimits.permite_pdv_offline ?? false,
    permite_suporte_prioritario: rawLimits.permite_suporte_prioritario ?? false,
  } : DEFAULT_LIMITS

  // Compute days remaining
  let diasRestantes: number | null = null
  if (sub.status === 'trial' && sub.trial_fim) {
    diasRestantes = Math.max(0, Math.ceil((new Date(sub.trial_fim).getTime() - Date.now()) / 86400000))
  } else if (sub.status === 'active' && sub.data_fim) {
    diasRestantes = Math.max(0, Math.ceil((new Date(sub.data_fim).getTime() - Date.now()) / 86400000))
  }

  // Assinatura sem acesso (aguardando pagamento, vencida, suspensa, bloqueada)
  // não libera nenhum módulo — sem isso, o menu (que só olha `modulos`,
  // não `subscriptionStatus`) mostraria tudo mesmo sem pagamento confirmado.
  const semAcesso = ['expired', 'blocked', 'suspended', 'pending'].includes(sub.status)

  return {
    planId: String(plan?.id ?? ''),
    planNome: String(plan?.nome ?? ''),
    planCodigo: String(plan?.codigo ?? ''),
    planCor: String(plan?.cor ?? '#3b82f6'),
    subscriptionId: sub.id,
    subscriptionStatus: sub.status as SubscriptionStatus,
    trialFim: sub.trial_fim ?? null,
    diasRestantes,
    modulos: isSystemAdmin ? ['*'] : (semAcesso ? [] : modulos),
    limites,
    isSystemAdmin,
    empresaId,
    role: null,
    suporte: null,
  }
}

// Server-side check: can this empresa access a module?
export async function podeAcessarModulo(modulo: string, empresaId: string, userId: string): Promise<boolean> {
  const plan = await loadPlanData(empresaId, userId)
  if (plan.isSystemAdmin) return true
  if (plan.subscriptionStatus === 'expired' || plan.subscriptionStatus === 'blocked' || plan.subscriptionStatus === 'suspended' || plan.subscriptionStatus === 'pending') return false
  return plan.modulos.includes(modulo)
}

// Server-side limit check: is the current usage below the plan limit?
export async function verificarLimite(
  campo: keyof PlanLimits,
  valorAtual: number,
  empresaId: string,
  userId: string
): Promise<{ permitido: boolean; limite: number; atual: number }> {
  const plan = await loadPlanData(empresaId, userId)
  if (plan.isSystemAdmin) return { permitido: true, limite: -1, atual: valorAtual }
  const limite = plan.limites[campo] as number
  if (limite === -1) return { permitido: true, limite: -1, atual: valorAtual }
  return { permitido: valorAtual < limite, limite, atual: valorAtual }
}
