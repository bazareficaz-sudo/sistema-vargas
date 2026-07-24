import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadPlanData } from '@/lib/plans/access'
import { provisionarEmpresaEUsuario } from '@/lib/signup/provisionar'
import PlanProvider from '@/components/plan/PlanProvider'
import DashboardShell from '@/components/DashboardShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, role, empresas(nome)')
    .eq('id', user.id)
    .single()

  // Rede de segurança: se o usuário se cadastrou pelo site mas ainda não tem
  // perfil (ex.: confirmou o e-mail e entrou direto por /login em vez de
  // passar pelo /auth/callback, que é onde isso normalmente aconteceria),
  // completa o provisionamento aqui — primeira vez que abre o painel.
  if (!profile && user.user_metadata?.pending_signup) {
    await provisionarEmpresaEUsuario(createAdminClient(), user.id, user.user_metadata)
    const retry = await supabase
      .from('profiles')
      .select('empresa_id, role, empresas(nome)')
      .eq('id', user.id)
      .single()
    profile = retry.data
  }

  const empresaId = profile?.empresa_id ?? ''
  const empresaNome = (profile?.empresas as unknown as { nome: string } | null)?.nome ?? 'Minha Empresa'

  const planData = await loadPlanData(empresaId, user.id)

  return (
    <PlanProvider data={planData}>
      <DashboardShell empresa={empresaNome}>{children}</DashboardShell>
    </PlanProvider>
  )
}
