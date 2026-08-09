import { createClient } from '@/lib/supabase/server'
import TiposDespesaClient from '@/components/contas-pagar/TiposDespesaClient'

export const dynamic = 'force-dynamic'

export default async function TiposDespesaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: tipos } = await supabase
    .from('tipos_despesa')
    .select('id, nome, cor, ativo')
    .eq('empresa_id', empresaId)
    .order('nome')

  // Quantas contas usam cada tipo — sem isso, desativar um tipo é decisão às
  // cegas ("posso tirar 'Frete'?" depende de quantas contas dependem dele).
  const { data: usos } = await supabase
    .from('contas_pagar')
    .select('tipo_despesa_id')
    .eq('empresa_id', empresaId)
    .not('tipo_despesa_id', 'is', null)

  const contagem: Record<string, number> = {}
  for (const u of usos ?? []) {
    const k = u.tipo_despesa_id as string
    contagem[k] = (contagem[k] ?? 0) + 1
  }

  return <TiposDespesaClient tipos={tipos ?? []} contagem={contagem} empresaId={empresaId} />
}
