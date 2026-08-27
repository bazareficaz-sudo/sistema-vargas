import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PromocoesClient from '@/components/marketplaces/PromocoesClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function PromocoesPage({ params }: { params: Promise<{ canalId: string }> }) {
  const { canalId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: canal } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .single()

  if (!canal) notFound()

  // Itens vêm juntos: uma campanha típica tem dezenas, não milhares, e a
  // tela precisa contar quantos e mostrar o preço de cada um. Se algum dia
  // uma campanha crescer a ponto de pesar, o corte é aqui — com medição,
  // como foi feito nas colunas da listagem de anúncios.
  const { data: promocoes } = await supabase
    .from('marketplace_promocoes')
    .select(`
      id, id_externo, nome, inicio, fim, status, sincronizado_em,
      marketplace_promocao_itens (
        id, item_id_externo, item_nome, model_id,
        preco_original, preco_promocional, limite_por_compra, estoque_promocao,
        anuncio_id, marketplace_anuncios ( id, titulo, sku_canal, status )
      )
    `)
    .eq('canal_id', canalId)
    .order('inicio', { ascending: false, nullsFirst: false })

  return (
    <PromocoesClient
      canal={canal}
      promocoes={promocoes ?? []}
      empresaId={empresaId}
    />
  )
}
