import { createClient } from '@/lib/supabase/server'
import ClientesAdminClient from '@/components/saas-admin/ClientesAdminClient'

export const dynamic = 'force-dynamic'

export default async function ClientesAdminPage() {
  const supabase = await createClient()

  const [{ data: subs }, { data: plans }] = await Promise.all([
    supabase.from('subscriptions').select(`
      id, status, data_inicio, data_fim, trial_inicio, trial_fim, plano_personalizado, created_at,
      empresa_id,
      empresas(id, nome),
      plans(id, nome, codigo, cor)
    `).order('created_at', { ascending: false }).limit(500),
    supabase.from('plans').select('id, nome, codigo').order('ordem'),
  ])

  type RawSub = {
    id: string; status: string; data_inicio: string; data_fim: string | null
    trial_inicio: string | null; trial_fim: string | null
    plano_personalizado: boolean; created_at: string; empresa_id: string
    empresas: { id: string; nome: string } | { id: string; nome: string }[] | null
    plans: { id: string; nome: string; codigo: string; cor: string } | { id: string; nome: string; codigo: string; cor: string }[] | null
  }

  const mapped = (subs as RawSub[] ?? []).map(s => {
    const emp = Array.isArray(s.empresas) ? s.empresas[0] : s.empresas
    const plan = Array.isArray(s.plans) ? s.plans[0] : s.plans
    const now = Date.now()
    let diasRestantes: number | null = null
    if (s.status === 'trial' && s.trial_fim)
      diasRestantes = Math.max(0, Math.ceil((new Date(s.trial_fim).getTime() - now) / 86400000))
    else if (s.status === 'active' && s.data_fim)
      diasRestantes = Math.max(0, Math.ceil((new Date(s.data_fim).getTime() - now) / 86400000))
    return {
      id: s.id,
      empresa_id: s.empresa_id,
      empresa_nome: emp?.nome ?? '—',
      plan_id: plan?.id ?? '',
      plan_nome: plan?.nome ?? '—',
      plan_cor: plan?.cor ?? '#64748b',
      status: s.status,
      data_inicio: s.data_inicio,
      trial_fim: s.trial_fim,
      data_fim: s.data_fim,
      diasRestantes,
      plano_personalizado: s.plano_personalizado,
      created_at: s.created_at,
    }
  })

  return <ClientesAdminClient clientes={mapped} plans={plans ?? []} />
}
