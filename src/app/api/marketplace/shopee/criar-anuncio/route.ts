import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { criarAnuncio } from '@/lib/shopee/listing'
import type { ShopeeChannel } from '@/lib/shopee/types'

export async function POST(req: Request) {
  const body = await req.json()
  const { canalId, produtoId, categoryId, categoriaIds, titulo, descricao, preco, estoque, peso, comprimento, largura, altura, brandId, brandNome, atributos, canaisLogisticaHabilitados } = body

  if (!canalId || !produtoId || !categoryId || !titulo || preco == null || estoque == null || !peso) {
    return NextResponse.json({ ok: false, erro: 'Dados obrigatórios ausentes (categoria, título, preço, estoque e peso são necessários).' }, { status: 400 })
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
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'shopee').single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado' }, { status: 404 })
  if (!canalRow.access_token) return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })

  const { data: produto } = await sb.from('produtos').select('id, categoria').eq('id', produtoId).eq('empresa_id', empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  const { data: imagemPrincipal } = await sb.from('produto_imagens').select('url').eq('produto_id', produtoId).eq('principal', true).maybeSingle()

  const canal: ShopeeChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  }

  const resultado = await criarAnuncio(sb, canal, {
    produtoId, empresaId,
    categoryId: Number(categoryId),
    titulo, descricao: descricao ?? '',
    preco: Number(preco), estoque: Number(estoque),
    pesoKg: Number(peso),
    comprimentoCm: comprimento ? Number(comprimento) : undefined,
    larguraCm: largura ? Number(largura) : undefined,
    alturaCm: altura ? Number(altura) : undefined,
    brandId: brandId != null ? Number(brandId) : undefined,
    brandNome,
    atributos: atributos ?? [],
    logisticaHabilitada: (canaisLogisticaHabilitados ?? []).map((id: any) => Number(id)),
    fotoUrl: imagemPrincipal?.url ?? null,
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

  // Lembra a categoria escolhida pra pré-selecionar automaticamente da
  // próxima vez que um produto com a mesma categoria interna for publicado.
  if (resultado.ok && produto.categoria && Array.isArray(categoriaIds) && categoriaIds.length > 0) {
    await sb.from('marketplace_categoria_sugestao').upsert({
      empresa_id: empresaId, canal_id: canalId, produto_categoria: produto.categoria,
      categoria_ids: categoriaIds.map((id: any) => Number(id)),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'empresa_id,canal_id,produto_categoria' })
  }

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })
  return NextResponse.json(resultado)
}
