import { createClient } from '@/lib/supabase/server'
import MarcasClient from '@/components/MarcasClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function MarcasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: marcas, error } = await supabase
    .from('marcas')
    .select('id, nome, ativo, created_at')
    .eq('empresa_id', empresaId)
    .order('nome')

  if (error) console.error('Erro ao buscar marcas:', error)
  console.log('empresaId:', empresaId, '| marcas count:', marcas?.length)

  return <MarcasClient marcas={marcas ?? []} empresaId={empresaId} />
}
