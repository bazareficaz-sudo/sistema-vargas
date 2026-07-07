import { createClient } from '@/lib/supabase/server'
import PrecosClient from '@/components/precos/PrecosClient'

export const dynamic = 'force-dynamic'
const POR_PAGINA = 100

export default async function PrecosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; aba?: string; categoria?: string }>
}) {
  const { q = '', pagina = '1', aba = 'precos', categoria = '' } = await searchParams
  const pg = Math.max(1, parseInt(pagina))
  const offset = (pg - 1) * POR_PAGINA

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  let query = supabase
    .from('produtos')
    .select('id, nome, sku, categoria, marca, preco_custo, preco_venda, markup, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, ativo, unidade', { count: 'exact' })
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome')
    .range(offset, offset + POR_PAGINA - 1)

  if (q) query = query.or(`nome.ilike.%${q}%,sku.ilike.%${q}%`)
  if (categoria) query = query.eq('categoria', categoria)

  const { data: produtos, count } = await query

  const { data: categorias } = await supabase
    .from('categorias')
    .select('id, nome')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome')

  const total = count ?? 0
  const totalPaginas = Math.ceil(total / POR_PAGINA)

  return (
    <PrecosClient
      produtos={produtos ?? []}
      total={total}
      pagina={pg}
      totalPaginas={totalPaginas}
      q={q}
      abaAtiva={aba}
      categoriaFiltro={categoria}
      categorias={categorias ?? []}
      empresaId={empresaId}
    />
  )
}
