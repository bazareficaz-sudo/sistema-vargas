import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { criarAnuncio } from '@/lib/mercadolivre/listing'
import type { MLChannel } from '@/lib/mercadolivre/types'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export async function POST(req: Request) {
  const body = await req.json()
  const { canalId, produtoId, categoryId, titulo, descricao, preco, estoque, condicao, listingTypeId, atributos, dimensoes , fotos} = body

  if (!canalId || !produtoId || !categoryId || !titulo || preco == null || estoque == null || !listingTypeId) {
    return NextResponse.json({ ok: false, erro: 'Dados obrigatórios ausentes (categoria, título, preço, estoque e tipo de anúncio são necessários).' }, { status: 400 })
  }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: canalRow } = await sb
    .from('marketplace_canais')
    .select('id, empresa_id, plataforma, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', empresaId).eq('plataforma', 'mercadolivre').single()

  if (!canalRow) return NextResponse.json({ ok: false, erro: 'Canal Mercado Livre não encontrado' }, { status: 404 })
  if (!canalRow.access_token) return NextResponse.json({ ok: false, erro: 'Canal não conectado — refaça a autenticação em Configurar.' }, { status: 400 })

  const { data: produto } = await sb.from('produtos')
    .select('id, peso_kg, comprimento_cm, largura_cm, altura_cm')
    .eq('id', produtoId).eq('empresa_id', empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  // O que a tela mandou tem prioridade (o operador pode ajustar na hora), mas
  // o cadastro serve de reserva. Sem peso e medidas o ML recusa a publicação.
  const dim = {
    pesoKg: Number(dimensoes?.pesoKg ?? produto.peso_kg ?? 0),
    comprimentoCm: Number(dimensoes?.comprimentoCm ?? produto.comprimento_cm ?? 0),
    larguraCm: Number(dimensoes?.larguraCm ?? produto.largura_cm ?? 0),
    alturaCm: Number(dimensoes?.alturaCm ?? produto.altura_cm ?? 0),
  }
  const faltando = Object.entries({
    peso: dim.pesoKg, comprimento: dim.comprimentoCm, largura: dim.larguraCm, altura: dim.alturaCm,
  }).filter(([, v]) => !(v > 0)).map(([k]) => k)
  if (faltando.length > 0) {
    return NextResponse.json({ ok: false, erro: `O Mercado Livre exige peso e medidas do pacote. Faltando: ${faltando.join(', ')}. Preencha no cadastro do produto ou no próprio anúncio.` }, { status: 400 })
  }

  const { data: imagensProduto } = await sb.from('produto_imagens').select('url, principal').eq('produto_id', produtoId).order('ordem', { ascending: true })
  const urlsDoProduto = (imagensProduto ?? []).map((i: any) => i.url)
  // Ordem escolhida na tela manda — é assim que se troca a foto principal de
  // um anúncio (a primeira da lista é a capa) sem mexer na imagem principal
  // do cadastro, que continua valendo pro PDV e pros outros anúncios.
  // Filtra contra as imagens do próprio produto: a tela só oferece essas, e
  // aceitar URL arbitrária do cliente seria publicar imagem de qualquer lugar.
  const ordemEscolhida = Array.isArray(fotos) ? fotos.filter((u: any) => typeof u === 'string' && urlsDoProduto.includes(u)) : []
  const fotoUrls = ordemEscolhida.length > 0
    ? ordemEscolhida
    : (imagensProduto ?? []).sort((a: any, b: any) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)).map((i: any) => i.url)
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
    dimensoes: dim,
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
