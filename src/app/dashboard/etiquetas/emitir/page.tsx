import { createClient } from '@/lib/supabase/server'
import EmitirEtiquetasClient from '@/components/etiquetas/EmitirEtiquetasClient'

export const dynamic = 'force-dynamic'

export default async function EmitirEtiquetasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const [{ data: marcas }, { data: categorias }, { data: tagsRows }] = await Promise.all([
    supabase.from('marcas').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    supabase.from('categorias').select('id, nome, pai_id').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    supabase.from('produtos').select('tags').eq('empresa_id', empresaId).not('tags', 'eq', '{}'),
  ])

  const tagsDisponiveis = Array.from(new Set<string>((tagsRows ?? []).flatMap((r: any) => (r.tags ?? []) as string[]))).sort()

  return (
    <EmitirEtiquetasClient
      empresaId={empresaId}
      marcas={marcas ?? []}
      categorias={(categorias ?? []).filter((c: any) => !c.pai_id)}
      tagsDisponiveis={tagsDisponiveis}
    />
  )
}
