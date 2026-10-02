import { NextResponse } from 'next/server'
import { canalTiktokDaSessao } from '@/lib/tiktok/canalDaSessao'
import { criarAnuncio } from '@/lib/tiktok/listing'

// Publicar produto novo na TikTok Shop. As imagens sobem uma a uma para a
// TikTok (ela não baixa por URL), por isso o tempo maior.
export const maxDuration = 120

export async function POST(req: Request) {
  const body = await req.json()
  const {
    canalId, produtoId, titulo, descricao, preco, estoque, sku, ean,
    categoryId, brandId, atributos, peso, comprimento, largura, altura, fotos,
  } = body

  if (!produtoId || !titulo || preco == null || estoque == null || !categoryId) {
    return NextResponse.json({ ok: false, erro: 'Dados obrigatórios ausentes (título, categoria, preço e estoque).' }, { status: 400 })
  }
  const g = await canalTiktokDaSessao(canalId)
  if (!g.ok) return NextResponse.json({ ok: false, erro: g.erro }, { status: g.status })
  const { sb, empresaId, canal } = g

  const { data: produto } = await sb.from('produtos')
    .select('id, sku, ean, descricao_marketplace, peso_kg, comprimento_cm, largura_cm, altura_cm')
    .eq('id', produtoId).eq('empresa_id', empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  const { data: imagensProduto } = await sb.from('produto_imagens')
    .select('url, principal').eq('produto_id', produtoId).order('ordem', { ascending: true })
  const urlsDoProduto = (imagensProduto ?? []).map((i: any) => i.url)
  // Só imagens do próprio produto, na ordem escolhida na tela (a primeira é
  // a capa) — aceitar URL arbitrária do cliente seria publicar qualquer coisa.
  const ordemEscolhida = Array.isArray(fotos) ? fotos.filter((u: any) => typeof u === 'string' && urlsDoProduto.includes(u)) : []
  const fotoUrls: string[] = ordemEscolhida.length > 0
    ? ordemEscolhida
    : (imagensProduto ?? []).sort((a: any, b: any) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)).map((i: any) => i.url)
  if (fotoUrls.length === 0) {
    return NextResponse.json({ ok: false, erro: 'A TikTok exige ao menos uma imagem — cadastre fotos no produto.' }, { status: 400 })
  }

  const pesoKg = peso ? Number(peso) : Number(produto.peso_kg ?? 0)
  if (!(pesoKg > 0)) return NextResponse.json({ ok: false, erro: 'Informe o peso da embalagem — a TikTok exige.' }, { status: 400 })

  const descricaoFinal = typeof descricao === 'string' ? descricao.trim() : ''
  const resultado = await criarAnuncio(sb, canal, {
    produtoId,
    titulo: String(titulo).trim(),
    descricao: descricaoFinal,
    categoryId: String(categoryId),
    brandId: brandId ? String(brandId) : null,
    preco: Number(preco),
    estoque: Number(estoque),
    // O cadastro serve de reserva para o que a tela não mandou.
    sku: sku ?? produto.sku ?? null,
    ean: ean ?? produto.ean ?? null,
    pesoKg,
    comprimentoCm: comprimento ? Number(comprimento) : (produto.comprimento_cm ?? null),
    larguraCm: largura ? Number(largura) : (produto.largura_cm ?? null),
    alturaCm: altura ? Number(altura) : (produto.altura_cm ?? null),
    atributos: Array.isArray(atributos)
      ? atributos.map((a: any) => ({ id: String(a.id), valorId: a.valorId ?? null, valorTexto: a.valorTexto ?? null }))
      : [],
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

  // Descrição escrita aqui preenche o cadastro quando ele estava vazio —
  // nunca sobrescreve o que o operador já escreveu.
  let descricaoGravadaNoCadastro = false
  if (descricaoFinal && !produto.descricao_marketplace?.trim()) {
    const { error } = await sb.from('produtos')
      .update({ descricao_marketplace: descricaoFinal })
      .eq('id', produtoId).eq('empresa_id', empresaId)
    descricaoGravadaNoCadastro = !error
  }
  return NextResponse.json({ ...resultado, descricaoGravadaNoCadastro })
}
