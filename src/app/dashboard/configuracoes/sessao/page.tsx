import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SessaoConfig from '@/components/configuracoes/SessaoConfig'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { carregarConfigSessao } from '@/lib/auth/configSessao'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

export default async function SessaoConfigPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const [config, guarda] = await Promise.all([
    carregarConfigSessao(sb, empresaId),
    exigirPermissao(sb, 'gerenciar_configuracoes'),
  ])

  return <SessaoConfig configInicial={config} podeEditar={guarda.ok} />
}
