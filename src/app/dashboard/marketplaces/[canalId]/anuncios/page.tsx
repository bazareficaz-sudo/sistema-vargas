import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import AnunciosClient from '@/components/marketplaces/AnunciosClient'

export const dynamic = 'force-dynamic'

export default async function AnunciosPage({ params, searchParams }: {
  params: Promise<{ canalId: string }>
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const { canalId } = await params
  const { q = '', status = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: canal } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .single()

  if (!canal) notFound()

  const { data: canais } = await supabase
    .from('marketplace_canais')
    .select('id, nome')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  let query = supabase
    .from('marketplace_anuncios')
    .select('*, produtos(id, nome, sku, preco_venda, preco_custo, estoque, tipo, tags), marketplace_anuncio_variacoes(nome_variacao, sku_variacao)')
    .eq('canal_id', canalId)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (q) query = query.ilike('titulo', `%${q}%`)

  const { data: anuncios } = await query.limit(5000)

  // A busca de produto no modal de vínculo consulta o banco ao vivo
  // (ver AnunciosClient.tsx), então essa lista só serve como valor inicial/
  // fallback — não precisa (nem deve) tentar carregar o catálogo inteiro aqui.
  const { data: produtos } = await supabase
    .from('produtos')
    .select('id, nome, sku, preco_venda, preco_custo, estoque, ativo')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome')
    .limit(50)

  const { data: regras } = await supabase
    .from('marketplace_regras_preco')
    .select('*')
    .eq('canal_id', canalId)
    .eq('ativo', true)
    .order('nome')

  const { data: depositos } = await supabase
    .from('depositos')
    .select('id, nome')
    .eq('empresa_id', empresaId)
    .order('nome')

  return (
    <AnunciosClient
      canal={canal}
      canais={canais ?? []}
      anuncios={anuncios ?? []}
      produtos={produtos ?? []}
      empresaId={empresaId}
      qInicial={q}
      statusInicial={status}
      operador={user?.email ?? ''}
      regras={regras ?? []}
      depositos={depositos ?? []}
    />
  )
}
