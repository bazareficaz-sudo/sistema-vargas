import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadPlanData } from '@/lib/plans/access'
import PlanProvider from '@/components/plan/PlanProvider'
import DashboardShell from '@/components/DashboardShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, role, empresas(nome)')
    .eq('id', user.id)
    .single()

  const empresaId = profile?.empresa_id ?? ''
  const empresaNome = (profile?.empresas as unknown as { nome: string } | null)?.nome ?? 'Minha Empresa'

  const planData = await loadPlanData(empresaId, user.id)

  return (
    <PlanProvider data={planData}>
      <DashboardShell empresa={empresaNome}>{children}</DashboardShell>
    </PlanProvider>
  )
}
