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

  let query = supabase
    .from('marketplace_anuncios')
    .select('*, produtos(id, nome, sku, preco_venda, estoque)')
    .eq('canal_id', canalId)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (q) query = query.ilike('titulo', `%${q}%`)

  const { data: anuncios } = await query.limit(200)

  const { data: produtos } = await supabase
    .from('produtos')
    .select('id, nome, sku, preco_venda, preco_custo, estoque, ativo')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome')
    .limit(500)

  return (
    <AnunciosClient
      canal={canal}
      anuncios={anuncios ?? []}
      produtos={produtos ?? []}
      empresaId={empresaId}
      qInicial={q}
      statusInicial={status}
    />
  )
}
