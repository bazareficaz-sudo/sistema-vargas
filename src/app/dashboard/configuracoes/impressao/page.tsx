import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ImpressaoConfig from '@/components/configuracoes/ImpressaoConfig'
import type { ConfigImpressao } from '@/lib/vendas/comprovantePdf'

export const dynamic = 'force-dynamic'

export default async function ImpressaoPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: config }, { data: empresa }] = await Promise.all([
    sb.from('empresa_config_impressao').select('formato, mensagem_rodape, mostrar_sku').eq('empresa_id', empresaId).maybeSingle(),
    sb.from('empresas').select('nome').eq('id', empresaId).maybeSingle(),
  ])

  return (
    <ImpressaoConfig
      empresaId={empresaId}
      empresaNome={empresa?.nome ?? 'Minha empresa'}
      configInicial={(config as ConfigImpressao) ?? null}
    />
  )
}
