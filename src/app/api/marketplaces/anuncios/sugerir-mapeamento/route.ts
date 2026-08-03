import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { normalizarChave, similaridadeTexto } from '@/lib/texto/similaridade'

export const maxDuration = 60

// Sugestão de produto para um conjunto ESCOLHIDO de anúncios — diferente da
// tela de Revisão de Sugestões, que varre tudo que está sem vínculo.
//
// Além do casamento exato por SKU/EAN (o único que existia antes), aqui há
// um terceiro caminho: quando não há SKU que bata, compara o título do
// anúncio com o nome dos produtos e devolve os melhores candidatos. Era
// justamente o caso que ficava sem nenhuma ajuda — anúncio com SKU de outro
// sistema, ou sem SKU nenhum.

const LIMITE_ANUNCIOS = 200
const ALTERNATIVAS_POR_ANUNCIO = 5
const SCORE_MINIMO_ALTERNATIVA = 12

type Produto = { id: string; nome: string; sku: string | null; ean: string | null; preco_venda: number | null; estoque: number | null }

async function buscarTudo(sb: any, tabela: string, select: string, filtros: (q: any) => any) {
  const linhas: any[] = []
  const passo = 1000
  for (let de = 0; ; de += passo) {
    const { data, error } = await filtros(sb.from(tabela).select(select)).range(de, de + passo - 1)
    if (error) throw new Error(error.message)
    linhas.push(...(data ?? []))
    if (!data || data.length < passo) break
  }
  return linhas
}

function indexarPor(produtos: Produto[], campo: 'sku' | 'ean') {
  const mapa = new Map<string, Produto>()
  const duplicados = new Set<string>()
  for (const p of produtos) {
    const chave = normalizarChave(p[campo])
    if (!chave) continue
    if (mapa.has(chave)) { duplicados.add(chave); continue }
    mapa.set(chave, p)
  }
  // Chave repetida entre produtos não identifica ninguém — sugerir um dos dois
  // seria escolher no escuro. Sai da lista e o anúncio cai na busca por nome.
  for (const d of duplicados) mapa.delete(d)
  return mapa
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({}))
  const anuncioIds: string[] = Array.isArray(body?.anuncioIds) ? body.anuncioIds.slice(0, LIMITE_ANUNCIOS) : []
  if (anuncioIds.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum anúncio enviado' }, { status: 400 })
  }

  const { data: anuncios, error: erroAnuncios } = await sb
    .from('marketplace_anuncios')
    .select('id, titulo, sku_canal, preco_venda, imagens, produto_id, tem_variacao')
    .eq('empresa_id', guarda.empresaId)
    .in('id', anuncioIds)

  if (erroAnuncios) return NextResponse.json({ ok: false, erro: erroAnuncios.message }, { status: 500 })

  let produtos: Produto[]
  try {
    produtos = await buscarTudo(sb, 'produtos', 'id, nome, sku, ean, preco_venda, estoque',
      (q: any) => q.eq('empresa_id', guarda.empresaId).eq('ativo', true)) as Produto[]
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: `Catálogo: ${e?.message ?? e}` }, { status: 500 })
  }

  const porSku = indexarPor(produtos, 'sku')
  const porEan = indexarPor(produtos, 'ean')

  const resumo = (p: Produto) => ({
    id: p.id, nome: p.nome, sku: p.sku,
    precoVenda: Number(p.preco_venda ?? 0), estoque: Number(p.estoque ?? 0),
  })

  const itens = (anuncios ?? []).map(a => {
    const chave = normalizarChave(a.sku_canal)
    const exatoSku = chave ? porSku.get(chave) : undefined
    const exatoEan = chave && !exatoSku ? porEan.get(chave) : undefined
    const exato = exatoSku ?? exatoEan

    // Candidatos por nome — sempre calculados, mesmo quando há match exato.
    // Servem de alternativa a um clique quando a sugestão principal estiver
    // errada, que é o caso que o operador mais perde tempo resolvendo.
    const porNome = produtos
      .map(p => ({ p, score: similaridadeTexto(a.titulo, p.nome) }))
      .filter(x => x.score >= SCORE_MINIMO_ALTERNATIVA && x.p.id !== exato?.id)
      .sort((x, y) => y.score - x.score)
      .slice(0, ALTERNATIVAS_POR_ANUNCIO)

    const sugestao = exato
      ? {
          ...resumo(exato),
          metodo: exatoSku ? ('sku' as const) : ('ean' as const),
          // EAN é código global do produto: coincidir por acaso é
          // praticamente impossível, então vale 100 sem depender do nome.
          // SKU deste sistema é número sequencial e pode colidir com o SKU de
          // outro sistema — aí a semelhança do nome é o que dá (ou tira) a
          // confiança.
          score: exatoSku ? similaridadeTexto(a.titulo, exato.nome) : 100,
        }
      : porNome[0]
        ? { ...resumo(porNome[0].p), metodo: 'nome' as const, score: porNome[0].score }
        : null

    const alternativas = (exato ? porNome : porNome.slice(1))
      .map(x => ({ ...resumo(x.p), metodo: 'nome' as const, score: x.score }))

    return {
      id: a.id,
      titulo: a.titulo ?? '',
      skuCanal: a.sku_canal,
      precoAnuncio: Number(a.preco_venda ?? 0),
      imagem: Array.isArray(a.imagens) && a.imagens.length > 0 ? a.imagens[0] : null,
      jaMapeado: !!a.produto_id,
      temVariacao: !!a.tem_variacao,
      sugestao,
      alternativas,
    }
  })

  return NextResponse.json({
    ok: true,
    itens,
    totalProdutos: produtos.length,
    // Avisa quando a seleção foi cortada, em vez de devolver menos linhas
    // silenciosamente e o operador achar que mapeou tudo.
    limiteAtingido: Array.isArray(body?.anuncioIds) && body.anuncioIds.length > LIMITE_ANUNCIOS,
    limite: LIMITE_ANUNCIOS,
  })
}
