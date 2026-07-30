import { createClient } from '@/lib/supabase/server'
import PadraoAnuncioConfig from '@/components/configuracoes/PadraoAnuncioConfig'

export const dynamic = 'force-dynamic'

export default async function PadraoAnuncioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: config } = await supabase
    .from('empresa_config_anuncio')
    .select('regra_titulo, regra_descricao, tom_voz, evitar')
    .eq('empresa_id', empresaId)
    .maybeSingle()

  return <PadraoAnuncioConfig empresaId={empresaId} configInicial={config ?? null} />
}
