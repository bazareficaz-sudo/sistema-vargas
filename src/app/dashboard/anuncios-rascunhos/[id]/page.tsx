import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import RascunhoEditorClient from '@/components/marketplaces/RascunhoEditorClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function RascunhoEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()

  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const [rascunhoRes, historicoRes, canaisRes] = await Promise.all([
    sb.from('anuncio_rascunhos')
      .select('*, produtos(id, nome, sku, ean, preco_venda, preco_custo, estoque, marca)')
      .eq('id', id).eq('empresa_id', empresaId).maybeSingle(),
    sb.from('anuncio_rascunho_historico')
      .select('id, acao, observacao, created_at, usuario_nome')
      .eq('rascunho_id', id).eq('empresa_id', empresaId)
      .order('created_at', { ascending: false }).limit(20),
    // Canais para o painel de publicar. Só os ativos — publicar em canal
    // desligado não faria nada além de erro.
    sb.from('marketplace_canais')
      .select('id, nome, plataforma')
      .eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
  ])

  if (rascunhoRes.error) {
    // Erro de consulta virando "não encontrado" já escondeu problema demais
    // neste projeto — aqui ele aparece.
    return (
      <div className="p-6 max-w-2xl">
        <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-700">Não foi possível carregar o rascunho</p>
          <p className="text-xs text-red-600 mt-0.5">{rascunhoRes.error.message}</p>
        </div>
      </div>
    )
  }
  if (!rascunhoRes.data) notFound()

  return (
    <RascunhoEditorClient
      rascunho={rascunhoRes.data as any}
      historico={(historicoRes.data ?? []) as any[]}
      canais={(canaisRes.data ?? []) as any[]}
      empresaId={empresaId}
    />
  )
}
