import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { normalizarChave, similaridadeTexto } from '@/lib/texto/similaridade'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Sugestão de produto do ERP para um rascunho capturado.
//
// Mesmo motor da tela de Mapeamento Rápido (SKU exato → EAN exato →
// semelhança de nome), com um sinal a mais que só o rascunho tem: a ficha
// técnica da origem. Quando o anúncio traz "Código universal de produto"
// (o GTIN/EAN), esse é o casamento mais confiável que existe — código global
// do produto não coincide por acaso, ao contrário do SKU sequencial deste
// sistema, que pode bater com o SKU de outro sistema por puro azar.

const ALTERNATIVAS = 6
const SCORE_MINIMO = 12

type Produto = { id: string; nome: string; sku: string | null; ean: string | null; preco_venda: number | null; preco_custo: number | null; estoque: number | null; marca: string | null }

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
  // Chave repetida não identifica ninguém — sugerir um dos dois seria
  // escolher no escuro. Sai do índice e o rascunho cai na busca por nome.
  for (const d of duplicados) mapa.delete(d)
  return mapa
}

/** Procura um código de barras na ficha técnica capturada. */
function eanDosAtributos(atributos: any[]): string | null {
  const chaves = ['codigo universal', 'código universal', 'gtin', 'ean', 'codigo de barras', 'código de barras']
  for (const a of atributos ?? []) {
    const nome = String(a?.nome ?? '').toLowerCase()
    if (!chaves.some(c => nome.includes(c))) continue
    const so = String(a?.valor ?? '').replace(/\D/g, '')
    // EAN-8/12/13/14. Fora dessa faixa é outro código qualquer.
    if (so.length >= 8 && so.length <= 14) return so
  }
  return null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: rascunho, error: erroRascunho } = await sb
    .from('anuncio_rascunhos')
    .select('id, titulo, dados_origem, produto_id')
    .eq('id', id)
    .eq('empresa_id', guarda.empresaId)
    .maybeSingle()

  if (erroRascunho) return NextResponse.json({ ok: false, erro: erroRascunho.message }, { status: 500 })
  if (!rascunho) return NextResponse.json({ ok: false, erro: 'Rascunho não encontrado' }, { status: 404 })

  let produtos: Produto[]
  try {
    produtos = await buscarTudo(sb, 'produtos',
      'id, nome, sku, ean, preco_venda, preco_custo, estoque, marca',
      (q: any) => q.eq('empresa_id', guarda.empresaId).eq('ativo', true)) as Produto[]
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: `Catálogo: ${e?.message ?? e}` }, { status: 500 })
  }

  const origem = (rascunho.dados_origem ?? {}) as any
  const titulo = rascunho.titulo ?? origem.titulo ?? ''
  const marcaOrigem = origem.marca ?? null
  const ean = eanDosAtributos(origem.atributos ?? [])

  const porEan = indexarPor(produtos, 'ean')
  const porSku = indexarPor(produtos, 'sku')

  const resumo = (p: Produto) => ({
    id: p.id, nome: p.nome, sku: p.sku, ean: p.ean, marca: p.marca,
    precoVenda: Number(p.preco_venda ?? 0),
    precoCusto: Number(p.preco_custo ?? 0),
    estoque: Number(p.estoque ?? 0),
  })

  const exatoEan = ean ? porEan.get(normalizarChave(ean)) : undefined
  // Rascunho capturado não tem SKU do nosso catálogo — mas quando o anúncio
  // de origem traz um código que por acaso é um SKU nosso, vale conferir.
  const codigoOrigem = normalizarChave(origem.codigoVendedor ?? origem.sku ?? '')
  const exatoSku = !exatoEan && codigoOrigem ? porSku.get(codigoOrigem) : undefined
  const exato = exatoEan ?? exatoSku

  // O nome do produto é comparado com título + marca da origem. A marca ajuda
  // a separar dois produtos de nome parecido de fabricantes diferentes.
  const textoOrigem = [titulo, marcaOrigem].filter(Boolean).join(' ')
  const porNome = produtos
    .map(p => ({ p, score: similaridadeTexto(textoOrigem, [p.nome, p.marca].filter(Boolean).join(' ')) }))
    .filter(x => x.score >= SCORE_MINIMO && x.p.id !== exato?.id)
    .sort((x, y) => y.score - x.score)
    .slice(0, ALTERNATIVAS)

  const sugestao = exato
    ? {
        ...resumo(exato),
        metodo: exatoEan ? ('ean' as const) : ('sku' as const),
        // EAN é código global: vale 100 sem depender do nome. SKU pode ser
        // coincidência entre catálogos, então quem dá a confiança é o nome.
        score: exatoEan ? 100 : similaridadeTexto(textoOrigem, exato.nome),
      }
    : porNome[0]
      ? { ...resumo(porNome[0].p), metodo: 'nome' as const, score: porNome[0].score }
      : null

  const alternativas = (exato ? porNome : porNome.slice(1))
    .map(x => ({ ...resumo(x.p), metodo: 'nome' as const, score: x.score }))

  return NextResponse.json({
    ok: true,
    jaVinculado: !!rascunho.produto_id,
    eanEncontrado: ean,
    sugestao,
    alternativas,
    totalProdutos: produtos.length,
  })
}
