import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadPlanData } from '@/lib/plans/access'
import Sidebar from '@/components/Sidebar'
import PlanProvider from '@/components/plan/PlanProvider'
import { PlanAlertBanner } from '@/components/plan/PlanBanner'

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
      <div className="min-h-screen flex" style={{ background: '#f1f5f9' }}>
        <Sidebar empresa={empresaNome} />
        <main
          id="main-content"
          className="flex-1 overflow-auto min-h-screen transition-[margin] duration-300 flex flex-col"
          style={{ marginLeft: '15rem' }}
        >
          <PlanAlertBanner />
          <div className="flex-1 p-7">{children}</div>
        </main>
      </div>
    </PlanProvider>
  )
}
