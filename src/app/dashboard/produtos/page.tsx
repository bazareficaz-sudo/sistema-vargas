import { createClient } from '@/lib/supabase/server'
import ProdutosClient from '@/components/produtos/ProdutosClient'

const POR_PAGINA = 50

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; aba?: string; promo?: string }>
}) {
  const { q = '', pagina = '1', aba = 'todos', promo = '' } = await searchParams
  const promoFiltro = promo === '1'
  const pg = Math.max(1, parseInt(pagina))
  const offset = (pg - 1) * POR_PAGINA

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  let query = supabase
    .from('produtos')
    .select('id, nome, sku, ean, preco_venda, preco_custo, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, unidade, categoria, marca, estoque, estoque_minimo, ativo, disponivel_pdv, permite_fracao, ncm, tipo', { count: 'exact' })
    .eq('empresa_id', empresaId)
    .order('nome')
    .range(offset, offset + POR_PAGINA - 1)

  if (q) query = query.or(`nome.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
  if (aba !== 'todos') {
    if (aba === 'simples') query = query.in('tipo', ['simples', 'normal', null as unknown as string])
    else query = query.eq('tipo', aba)
  }
  if (promoFiltro) query = query.eq('promocao_ativa', true)

  const { data: produtos, count } = await query

  // Contagens para as abas e promoção
  const [simplesRes, kitsRes, promoRes] = await Promise.all([
    supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).in('tipo', ['simples', 'normal']),
    supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('tipo', 'kit'),
    supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('promocao_ativa', true),
  ])
  const totalSimples = simplesRes.count
  const totalKits = kitsRes.count
  const totalEmPromocao = promoRes.count ?? 0

  const total = count ?? 0
  const totalPaginas = Math.ceil(total / POR_PAGINA)

  return (
    <ProdutosClient
      produtos={produtos ?? []}
      total={total}
      totalAtivos={total}
      totalInativos={0}
      totalSimples={totalSimples ?? 0}
      totalKits={totalKits ?? 0}
      totalEmPromocao={totalEmPromocao}
      pagina={pg}
      totalPaginas={totalPaginas}
      q={q}
      abaAtiva={aba}
      promoFiltro={promoFiltro}
      empresaId={empresaId}
    />
  )
}
