import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SaudeVendaConfig from '@/components/configuracoes/SaudeVendaConfig'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function SaudeVendaPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id, 'empresa_id, role')
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: config }, { data: faixas }] = await Promise.all([
    sb.from('saude_config').select('*').eq('empresa_id', empresaId).single(),
    sb.from('saude_faixas').select('*').eq('empresa_id', empresaId).order('ordem'),
  ])

  return (
    <SaudeVendaConfig
      empresaId={empresaId}
      configInicial={config}
      faixasIniciais={faixas ?? []}
      role={profile?.role ?? 'vendedor'}
    />
  )
}
