import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testarConexao } from '@/lib/shopee/sync'
import type { ShopeeChannel } from '@/lib/shopee/types'

export async function POST(req: Request) {
  const { canalId } = await req.json()
  if (!canalId) return NextResponse.json({ ok: false, erro: 'canalId ausente' }, { status: 400 })

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
    .eq('plataforma', 'shopee')
    .single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })
  }

  const canal: ShopeeChannel = {
    id: canalRow.id,
    empresaId: canalRow.empresa_id,
    sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token,
    refreshToken: canalRow.refresh_token,
    tokenExpiraEm: canalRow.token_expira_em,
  }

  const resultado = await testarConexao(sb, canal)

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: 'conexao',
    status: resultado.ok ? 'ok' : 'erro',
    mensagem: resultado.ok ? `Conectado — loja "${resultado.shopName}"` : resultado.error,
    detalhes: resultado,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.error }, { status: 400 })
  return NextResponse.json({ ok: true, shopName: resultado.shopName })
}
