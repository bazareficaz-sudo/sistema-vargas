import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { atualizarPrecoEstoque } from '@/lib/mercadolivre/write'
import type { MLChannel } from '@/lib/mercadolivre/types'

export async function POST(req: Request) {
  const { canalId, anuncioId } = await req.json()
  if (!canalId || !anuncioId) return NextResponse.json({ ok: false, erro: 'canalId/anuncioId ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'mercadolivre').single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Mercado Livre não encontrado' }, { status: 404 })
  if (!canalRow.access_token) return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })

  const { data: anuncio } = await sb
    .from('marketplace_anuncios')
    .select('id, empresa_id, canal_id, id_externo, preco_venda, estoque_reservado')
    .eq('id', anuncioId).eq('empresa_id', empresaId).eq('canal_id', canalId).single()

  if (!anuncio) return NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 })
  if (!anuncio.id_externo) return NextResponse.json({ ok: false, erro: 'Anúncio sem ID externo — não veio de sincronização.' }, { status: 400 })

  const canal: MLChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }

  const resultado = await atualizarPrecoEstoque(sb, canal, anuncio.id_externo, {
    preco: anuncio.preco_venda, estoque: anuncio.estoque_reservado,
  })

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: 'push_preco_estoque',
    status: resultado.ok ? 'ok' : 'erro',
    mensagem: resultado.ok ? 'Preço e estoque enviados com sucesso.' : resultado.erro,
    detalhes: resultado,
  })

  if (resultado.ok) {
    await sb.from('marketplace_anuncios').update({
      ultima_atualizacao: new Date().toISOString(), sincronizado_em: new Date().toISOString(),
    }).eq('id', anuncio.id)
  }

  return NextResponse.json(resultado.ok ? { ok: true } : { ok: false, erro: resultado.erro })
}
