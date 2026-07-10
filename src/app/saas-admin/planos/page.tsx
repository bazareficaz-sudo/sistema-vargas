import { createClient } from '@/lib/supabase/server'
import GerenciarPlanosClient from '@/components/saas-admin/GerenciarPlanosClient'
import { SYSTEM_MODULES } from '@/lib/plans/modules'

export const dynamic = 'force-dynamic'

export default async function PlanosAdminPage() {
  const supabase = await createClient()

  const { data: plans } = await supabase
    .from('plans')
    .select('*, plan_modules(modulo), plan_limits(*)')
    .order('ordem')

  const modulos = Object.entries(SYSTEM_MODULES).map(([key, cfg]) => ({ key, label: cfg.label }))

  return <GerenciarPlanosClient plans={plans ?? []} modulos={modulos} />
}
