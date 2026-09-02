import { createClient } from '@/lib/supabase/server'
import AgentesAdminClient from '@/components/saas-admin/AgentesAdminClient'
import type { AgenteCatalogo } from '@/lib/ia/agentes'

export const dynamic = 'force-dynamic'

export default async function AgentesAdminPage() {
  const sb = await createClient()

  const [{ data: agentes }, { data: planos }, { data: vinculos }, { data: contratos }] = await Promise.all([
    sb.from('ia_agentes').select('*').order('ordem').order('nome'),
    sb.from('plans').select('id, nome').order('ordem'),
    sb.from('plano_agentes').select('plan_id, agente_id, incluso, dias_carencia'),
    // Quantas empresas usam cada agente. Serve para a tela avisar antes de
    // alguem despublicar algo que esta em uso — despublicar nao cancela
    // contrato, mas some da vitrine, e quem ja tem continua pagando por algo
    // que nao aparece mais.
    sb.from('empresa_agentes').select('agente_id').neq('status', 'cancelado'),
  ])

  const contratados: Record<string, number> = {}
  for (const c of contratos ?? []) {
    contratados[c.agente_id] = (contratados[c.agente_id] ?? 0) + 1
  }

  return (
    <AgentesAdminClient
      agentes={(agentes ?? []) as AgenteCatalogo[]}
      planos={planos ?? []}
      planoAgentes={vinculos ?? []}
      contratados={contratados}
    />
  )
}
