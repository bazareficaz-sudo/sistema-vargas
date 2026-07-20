import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncSingleItem } from '@/lib/mercadolivre/sync'
import type { MLChannel } from '@/lib/mercadolivre/types'

export async function POST(req: Request) {
  const { canalId, idExterno } = await req.json()
  if (!canalId || !idExterno) return NextResponse.json({ ok: false, erro: 'canalId/idExterno ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .eq('plataforma', 'mercadolivre')
    .single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Mercado Livre não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })
  }

  const canal: MLChannel = {
    id: canalRow.id,
    empresaId: canalRow.empresa_id,
    sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token,
    refreshToken: canalRow.refresh_token,
    tokenExpiraEm: canalRow.token_expira_em,
  }

  const resultado = await syncSingleItem(sb, canal, String(idExterno))

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: 'produto_sync_item',
    status: resultado.ok ? 'ok' : 'erro',
    mensagem: resultado.ok
      ? `Item ${idExterno} sincronizado${resultado.warnings.length ? ` (${resultado.warnings.length} aviso(s))` : ''}`
      : resultado.error,
    detalhes: resultado,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.error }, { status: 400 })

  const { data: anuncio } = await sb
    .from('marketplace_anuncios')
    .select('*, produtos(id, nome, sku, preco_venda, preco_custo, estoque, tipo, tags)')
    .eq('id', resultado.anuncioId)
    .single()

  const { data: variacoes } = await sb
    .from('marketplace_anuncio_variacoes')
    .select('*, produtos(id, nome, sku)')
    .eq('anuncio_id', resultado.anuncioId)
    .order('nome_variacao')

  return NextResponse.json({ ok: true, anuncio, variacoes: variacoes ?? [], warnings: resultado.warnings })
}
