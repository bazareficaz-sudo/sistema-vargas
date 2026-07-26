import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { criarAnuncio } from '@/lib/mercadolivre/listing'
import type { MLChannel } from '@/lib/mercadolivre/types'

export async function POST(req: Request) {
  const body = await req.json()
  const { canalId, produtoId, categoryId, titulo, descricao, preco, estoque, condicao, listingTypeId, atributos } = body

  if (!canalId || !produtoId || !categoryId || !titulo || preco == null || estoque == null || !listingTypeId) {
    return NextResponse.json({ ok: false, erro: 'Dados obrigatórios ausentes (categoria, título, preço, estoque e tipo de anúncio são necessários).' }, { status: 400 })
  }

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

  const { data: produto } = await sb.from('produtos').select('id').eq('id', produtoId).eq('empresa_id', empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  const { data: imagensProduto } = await sb.from('produto_imagens').select('url, principal').eq('produto_id', produtoId).order('ordem', { ascending: true })
  const fotoUrls = (imagensProduto ?? []).sort((a: any, b: any) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)).map((i: any) => i.url)
  if (fotoUrls.length === 0) return NextResponse.json({ ok: false, erro: 'Produto sem nenhuma imagem cadastrada — o Mercado Livre exige pelo menos uma.' }, { status: 400 })

  const canal: MLChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }

  const resultado = await criarAnuncio(sb, canal, {
    produtoId, empresaId,
    categoryId: String(categoryId),
    titulo, descricao: descricao ?? '',
    preco: Number(preco), estoque: Number(estoque),
    condicao: condicao === 'used' ? 'used' : 'new',
    listingTypeId: String(listingTypeId),
    atributos: atributos ?? [],
    fotoUrls,
  })

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: 'criar_anuncio',
    status: resultado.ok ? 'ok' : 'erro',
    mensagem: resultado.ok
      ? `Anúncio criado (item ${resultado.itemId})${resultado.warning ? ` — ${resultado.warning}` : ''}`
      : resultado.erro,
    detalhes: resultado,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })
  return NextResponse.json(resultado)
}
