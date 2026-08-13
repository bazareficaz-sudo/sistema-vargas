import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { criarAnuncio } from '@/lib/nuvemshop/listing'
import { COLUNAS_CANAL, montarCanal } from '@/lib/nuvemshop/canal'

// Publicar produto novo na loja Nuvemshop. O envio das imagens é por URL (a
// Nuvemshop baixa da fonte), então esta rota não faz upload — só decide QUAIS
// imagens e em que ordem.
export const maxDuration = 120

export async function POST(req: Request) {
  const body = await req.json()
  const {
    canalId, produtoId, titulo, descricao, preco, precoDe, estoque, sku, ean, marca,
    categoriaIds, peso, comprimento, largura, altura, publicado, fotos,
  } = body

  if (!canalId || !produtoId || !titulo || preco == null || estoque == null) {
    return NextResponse.json({ ok: false, erro: 'Dados obrigatórios ausentes (título, preço e estoque são necessários).' }, { status: 400 })
  }

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

  const { data: produto } = await sb.from('produtos')
    .select('id, sku, ean, marca, descricao_marketplace, peso_kg, comprimento_cm, largura_cm, altura_cm')
    .eq('id', produtoId).eq('empresa_id', empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  const { data: imagensProduto } = await sb.from('produto_imagens')
    .select('url, principal').eq('produto_id', produtoId).order('ordem', { ascending: true })
  const urlsDoProduto = (imagensProduto ?? []).map((i: any) => i.url)
  // Ordem escolhida na tela manda — a primeira imagem é a capa na vitrine.
  // Filtra contra as imagens do próprio produto: a tela só oferece essas, e
  // aceitar URL arbitrária do cliente seria publicar imagem de qualquer lugar.
  const ordemEscolhida = Array.isArray(fotos) ? fotos.filter((u: any) => typeof u === 'string' && urlsDoProduto.includes(u)) : []
  const fotoUrls = ordemEscolhida.length > 0
    ? ordemEscolhida
    : (imagensProduto ?? []).sort((a: any, b: any) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)).map((i: any) => i.url)

  // Diferente de Shopee e Mercado Livre, a Nuvemshop aceita produto sem
  // imagem — quem avisa que a vitrine ficaria sem foto é a tela. Bloquear
  // aqui impediria o caso legítimo de publicar antes de fotografar.

  const canal = montarCanal(canalRow)
  const descricaoFinal = typeof descricao === 'string' ? descricao.trim() : ''

  const resultado = await criarAnuncio(sb, canal, {
    produtoId, empresaId,
    titulo: String(titulo).trim(),
    descricao: descricaoFinal,
    preco: Number(preco),
    precoDe: precoDe != null && precoDe !== '' ? Number(precoDe) : null,
    estoque: Number(estoque),
    // O cadastro serve de reserva para o que a tela não mandou.
    sku: sku ?? produto.sku ?? null,
    ean: ean ?? produto.ean ?? null,
    marca: marca ?? produto.marca ?? null,
    categoriaIds: Array.isArray(categoriaIds) ? categoriaIds.map((id: any) => Number(id)).filter(Boolean) : [],
    pesoKg: peso ? Number(peso) : (produto.peso_kg ?? null),
    comprimentoCm: comprimento ? Number(comprimento) : (produto.comprimento_cm ?? null),
    larguraCm: largura ? Number(largura) : (produto.largura_cm ?? null),
    alturaCm: altura ? Number(altura) : (produto.altura_cm ?? null),
    publicado: publicado !== false,
    fotoUrls,
  })

  await sb.from('marketplace_sync_log').insert({
    canal_id: canalId,
    tipo: 'criar_anuncio',
    status: resultado.ok ? 'ok' : 'erro',
    mensagem: resultado.ok
      ? `Anúncio criado (produto ${resultado.itemId})${resultado.warning ? ` — ${resultado.warning}` : ''}`
      : resultado.erro,
    detalhes: resultado,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })

  // Descrição escrita aqui (quase sempre pela IA) vira descrição do produto
  // quando o cadastro não tinha nenhuma: assim o trabalho não fica preso a
  // este anúncio e já entra pronto no próximo canal. Nunca sobrescreve o que
  // o operador escreveu antes — só preenche o que estava vazio.
  let descricaoGravadaNoCadastro = false
  if (descricaoFinal && !produto.descricao_marketplace?.trim()) {
    const { error } = await sb.from('produtos')
      .update({ descricao_marketplace: descricaoFinal })
      .eq('id', produtoId).eq('empresa_id', empresaId)
    descricaoGravadaNoCadastro = !error
  }

  return NextResponse.json({ ...resultado, descricaoGravadaNoCadastro })
}
