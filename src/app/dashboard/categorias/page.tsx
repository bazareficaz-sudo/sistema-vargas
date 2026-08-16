import { createClient } from '@/lib/supabase/server'
import CategoriasClient from '@/components/CategoriasClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export default async function CategoriasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: categorias } = await supabase
    .from('categorias')
    .select('id, nome, pai_id, ativo, created_at')
    .eq('empresa_id', empresaId)
    .order('nome')

  // Quantos produtos usam cada categoria. Serve para o gestor saber o que está
  // movendo antes de mover — e para enxergar as categorias duplicadas, que na
  // base real são muitas (MATERIAL HIDRÁULICO com 1.788 produtos convivendo
  // com MATERIAL HIDRAULICO com 762).
  //
  // Lido em páginas porque o PostgREST corta em 1.000 linhas, e um catálogo de
  // 14 mil produtos calaria a contagem sem avisar.
  const contagem: Record<string, number> = {}
  for (let de = 0; ; de += 1000) {
    const { data } = await supabase.from('produtos')
      .select('categoria, subcategoria')
      .eq('empresa_id', empresaId).eq('ativo', true)
      .range(de, de + 999)
    if (!data || data.length === 0) break
    for (const p of data) {
      const cat = (p.categoria ?? '').trim()
      if (cat) contagem[cat] = (contagem[cat] ?? 0) + 1
      const sub = ((p as any).subcategoria ?? '').trim()
      if (sub) contagem[sub] = (contagem[sub] ?? 0) + 1
    }
    if (data.length < 1000) break
  }

  return <CategoriasClient categorias={categorias ?? []} empresaId={empresaId} contagem={contagem} />
}
