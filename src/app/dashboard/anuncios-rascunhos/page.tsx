import { createClient } from '@/lib/supabase/server'
import AnunciosRascunhosClient from '@/components/marketplaces/AnunciosRascunhosClient'

export const dynamic = 'force-dynamic'

export default async function AnunciosRascunhosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; busca?: string }>
}) {
  const { status = '', busca = '' } = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  let query = supabase
    .from('anuncio_rascunhos')
    .select('id, titulo, origem, origem_marketplace, origem_url, origem_vendedor, preco_origem, imagem_principal, qtd_imagens, tem_variacao, produto_id, status, colecao, capturado_em, produtos(id, nome, sku)')
    .eq('empresa_id', empresaId)
    .is('arquivado_em', null)
    .order('capturado_em', { ascending: false })
    .limit(200)

  if (status) query = query.eq('status', status)
  if (busca) query = query.ilike('titulo', `%${busca}%`)

  // Erro de consulta virando lista vazia já escondeu problema demais neste
  // projeto — aqui ele sobe para a tela.
  const { data: rascunhos, error } = await query

  return (
    <AnunciosRascunhosClient
      rascunhos={(rascunhos ?? []) as any[]}
      erro={error?.message ?? ''}
      statusFiltro={status}
      buscaFiltro={busca}
    />
  )
}
