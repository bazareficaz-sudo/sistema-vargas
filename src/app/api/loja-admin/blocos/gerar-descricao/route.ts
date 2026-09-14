import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'
import { perguntarJSON } from '@/lib/ia/claude'

// "Gerar descrição com IA", pedido junto do destaque por tag: uma frase
// curta para o slide do carrossel, só para quem ainda NÃO tem
// `loja_produtos.descricao_curta` — nunca sobrescreve o que já foi escrito à
// mão, mesma regra da IA da Nuvemshop (ver
// src/app/api/marketplace/nuvemshop/ia-gerar-conteudo/route.ts).
//
// Uma chamada de IA por produto, não em lote: o texto depende do produto, e
// são no máximo `limite` produtos (2 a 24) — a mesma ordem de grandeza que a
// IA de conteúdo de anúncio já paga por produto, uma vez, sob clique do
// operador, nunca automático.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMITE_MAX = 24

async function gerarDescricao(p: { nome: string; marca: string | null; categoria: string | null; descricaoCompleta: string | null }): Promise<string | null> {
  const prompt = `Escreva UMA frase curta de vitrine (até 90 caracteres) para um produto de loja de material de construção brasileira, para aparecer como legenda num banner de destaque, ao lado do preço.

Produto: "${p.nome}"${p.marca ? ` — marca: ${p.marca}` : ''}
${p.categoria ? `Categoria: ${p.categoria}` : ''}
${p.descricaoCompleta ? `Descrição já cadastrada: ${p.descricaoCompleta.slice(0, 300)}` : ''}

Regras:
- Português correto e acentuado, mesmo que o nome venha abreviado no cadastro.
- NUNCA invente medida, peso, rendimento, composição, voltagem, garantia ou certificação que não estejam acima.
- Não afirme estado de preparo ("pronto para uso") nem desempenho (rendimento, resistência, durabilidade) — muda de fabricante para fabricante e não está no cadastro.
- Sem preço, sem prazo de entrega, sem emoji, sem ponto final.
- Uma frase só, direto ao ponto do que o produto é ou resolve.

Responda SOMENTE com um JSON: {"descricao": "<frase>"}`

  try {
    const r = await perguntarJSON(prompt)
    const texto = typeof r?.descricao === 'string' ? r.descricao.trim().slice(0, 150) : ''
    return texto || null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as { lojaId?: string; tag?: string } | null
  if (!corpo?.lojaId || !UUID.test(corpo.lojaId)) {
    return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  }
  if (!(await lojaDaSessao(ctx, corpo.lojaId))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }
  const tag = typeof corpo.tag === 'string' ? corpo.tag.trim() : ''
  if (!tag) return NextResponse.json({ erro: 'Escolha uma tag' }, { status: 400 })

  // Candidatos: publicados nesta loja, com a tag, e SEM descrição própria —
  // é exatamente o que o carrossel mostraria sem ajuda nenhuma.
  const { data: candidatos, error } = await ctx.sb
    .from('loja_produtos')
    .select('produto_id, descricao_curta, descricao_completa, produtos!inner(nome, marca, categoria, tags)')
    .eq('loja_id', corpo.lojaId).eq('status', 'publicado')
    .is('descricao_curta', null)
    .contains('produtos.tags', [tag])
    .limit(LIMITE_MAX)

  if (error) {
    console.error('[loja-admin] blocos/gerar-descricao falhou ao buscar candidatos', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível buscar os produtos' }, { status: 500 })
  }
  if (!candidatos || candidatos.length === 0) {
    return NextResponse.json({ ok: true, geradas: 0, aviso: 'Nenhum produto desta tag está sem descrição.' })
  }

  let geradas = 0
  for (const c of candidatos as any[]) {
    const prod = c.produtos
    const descricao = await gerarDescricao({
      nome: prod.nome, marca: prod.marca, categoria: prod.categoria,
      descricaoCompleta: c.descricao_completa,
    })
    if (!descricao) continue
    const { error: eUpdate } = await ctx.sb
      .from('loja_produtos').update({ descricao_curta: descricao })
      .eq('loja_id', corpo.lojaId).eq('produto_id', c.produto_id)
      .is('descricao_curta', null) // nunca por cima do que já existe, nem de uma escrita concorrente
    if (!eUpdate) geradas++
  }

  if (geradas > 0) invalidarVitrine(corpo.lojaId)
  return NextResponse.json({ ok: true, geradas, total: candidatos.length })
}
