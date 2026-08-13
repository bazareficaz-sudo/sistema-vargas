import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncSingleItem } from '@/lib/nuvemshop/sync'
import { COLUNAS_CANAL, montarCanal } from '@/lib/nuvemshop/canal'

// Sincroniza UM produto da loja de volta para marketplace_anuncios — o botão
// 🔄 das telas de anúncio. Existia para Shopee e Mercado Livre; sem o
// equivalente aqui, um anúncio Nuvemshop era mandado para a rota da Shopee e
// voltava com "canal não encontrado".
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
    .select(COLUNAS_CANAL)
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'nuvemshop')
    .maybeSingle()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Nuvemshop não encontrado' }, { status: 404 })
  if (!canalRow.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autorização em Configurar.' }, { status: 400 })
  }

  const resultado = await syncSingleItem(sb, montarCanal(canalRow), String(idExterno))

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: 'produto_sync_item',
    status: resultado.ok ? 'ok' : 'erro',
    mensagem: resultado.ok
      ? `Produto ${idExterno} sincronizado${resultado.warnings.length ? ` (${resultado.warnings.length} aviso(s))` : ''}`
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
