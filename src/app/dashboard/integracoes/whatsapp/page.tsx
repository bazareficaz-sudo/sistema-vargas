import { createClient } from '@/lib/supabase/server'
import WhatsAppConfigClient from '@/components/integracoes/WhatsAppConfigClient'

export const dynamic = 'force-dynamic'

export default async function WhatsAppPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id, nome').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: empresa } = await supabase.from('empresas').select('nome, telefone').eq('id', empresaId).single()

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('empresa_id', empresaId)
    .single()

  const { data: modelos } = await supabase
    .from('whatsapp_modelos')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('nome')

  return (
    <WhatsAppConfigClient
      empresaId={empresaId}
      empresaNome={empresa?.nome ?? ''}
      empresaTelefone={empresa?.telefone ?? ''}
      configInicial={config ?? null}
      modelosIniciais={modelos ?? []}
    />
  )
}
