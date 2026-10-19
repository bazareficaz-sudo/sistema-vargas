import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { refreshAccessTokenIfNeeded } from '@/lib/shopee/client'
import { destinatarioEmImagem } from '@/lib/shopee/logistics'
import type { ShopeeChannel } from '@/lib/shopee/types'

// Nome, telefone e endereço do comprador de um pedido Shopee, nas imagens
// que a Shopee fornece para a etiqueta (em texto ela não libera). Nada é
// gravado: a tela mostra enquanto o pedido está aberto.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ANTES_DO_ENVIO = new Set(['UNPAID', 'CANCELLED', 'IN_CANCEL'])

export async function POST(req: Request) {
  const { pedidoId } = await req.json().catch(() => ({})) as { pedidoId?: string }
  if (!pedidoId || !UUID.test(pedidoId)) return NextResponse.json({ ok: false, erro: 'Pedido inválido' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })
  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: pedido } = await sb.from('marketplace_pedidos')
    .select('id, id_externo, status_externo, canal_id, marketplace_pedido_pacotes(package_number_externo)')
    .eq('id', pedidoId).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido) return NextResponse.json({ ok: false, erro: 'Pedido não encontrado' }, { status: 404 })
  if (ANTES_DO_ENVIO.has(String(pedido.status_externo))) {
    return NextResponse.json({ ok: false, erro: pedido.status_externo === 'UNPAID'
      ? 'A Shopee só libera o destinatário depois que o pagamento é aprovado.'
      : 'Pedido cancelado: a Shopee não libera o destinatário.' }, { status: 400 })
  }

  const { data: canalRow } = await sb.from('marketplace_canais')
    .select('id, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', pedido.canal_id).eq('empresa_id', empresaId).eq('plataforma', 'shopee').maybeSingle()
  if (!canalRow?.access_token) return NextResponse.json({ ok: false, erro: 'Canal Shopee não conectado' }, { status: 400 })

  try {
    const canal = await refreshAccessTokenIfNeeded(sb, {
      id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
      accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
    } as ShopeeChannel)
    const pacote = (pedido as { marketplace_pedido_pacotes?: { package_number_externo: string | null }[] }).marketplace_pedido_pacotes?.[0]?.package_number_externo ?? undefined
    const imagens = await destinatarioEmImagem({ sb, canal }, String(pedido.id_externo), pacote)
    if (Object.keys(imagens).length === 0) return NextResponse.json({ ok: false, erro: 'A Shopee não devolveu o destinatário deste pedido.' }, { status: 400 })
    return NextResponse.json({ ok: true, imagens })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Erro na Shopee' }, { status: 400 })
  }
}
