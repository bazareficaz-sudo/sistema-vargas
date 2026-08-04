import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ComprasConfig from '@/components/configuracoes/ComprasConfig'

export const dynamic = 'force-dynamic'

export default async function ComprasConfigPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  // maybeSingle: empresas antigas podem não ter linha de config comercial —
  // nesse caso a tela abre com os padrões e o primeiro salvamento cria a linha.
  const { data: config } = await sb.from('empresa_config_comercial')
    .select('alerta_aumento_custo_ativo, alerta_aumento_custo_pct')
    .eq('empresa_id', empresaId)
    .maybeSingle()

  return <ComprasConfig empresaId={empresaId} configInicial={config} />
}
