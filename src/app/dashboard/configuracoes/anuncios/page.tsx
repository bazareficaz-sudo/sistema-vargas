import { createClient } from '@/lib/supabase/server'
import PadraoAnuncioConfig from '@/components/configuracoes/PadraoAnuncioConfig'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function PadraoAnuncioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: config } = await supabase
    .from('empresa_config_anuncio')
    .select('regra_titulo, regra_descricao, tom_voz, evitar')
    .eq('empresa_id', empresaId)
    .maybeSingle()

  return <PadraoAnuncioConfig empresaId={empresaId} configInicial={config ?? null} />
}
