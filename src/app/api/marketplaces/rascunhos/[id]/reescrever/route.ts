import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perguntarJSON } from '@/lib/ia/claude'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Reescrita do conteúdo do rascunho.
//
// A limpeza determinística (limparTextoOrigem.ts) tira os nomes, mas o texto
// que sobra ainda é, palavra por palavra, o do vendedor de origem — e anúncio
// duplicado é penalizado no ranking dos marketplaces. Esta rota resolve o que
// aquela não resolve: devolve um texto novo, escrito do zero a partir dos
// FATOS do produto (ficha técnica, medidas, material), não do texto alheio.
//
// A ficha técnica capturada é a matéria-prima principal justamente porque
// especificação não é conteúdo criativo de ninguém: "diâmetro 2 cm" é o que
// é. Isso mantém a reescrita ancorada no produto real em vez de virar
// literatura solta.

const LIMITE_DESCRICAO_ENTRADA = 4000
const LIMITE_ATRIBUTOS = 40

/** Título de Mercado Livre é limitado a 60 caracteres. */
const MAX_TITULO = 60
const MAX_DESCRICAO = 3000

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const limpo = v.replace(/\s+/g, ' ').trim()
  return limpo ? limpo.slice(0, max) : null
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: rascunho, error } = await sb
    .from('anuncio_rascunhos')
    .select('id, titulo, origem_vendedor, dados_origem, produtos(nome, marca, sku)')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  if (!rascunho) return NextResponse.json({ ok: false, erro: 'Rascunho não encontrado' }, { status: 404 })

  const origem = (rascunho.dados_origem ?? {}) as any
  const produto = (rascunho.produtos ?? null) as any

  const atributos = Array.isArray(origem.atributos)
    ? origem.atributos.slice(0, LIMITE_ATRIBUTOS)
        .map((a: any) => `- ${a?.nome}: ${a?.valor}`).join('\n')
    : ''

  if (!origem.titulo && !atributos) {
    return NextResponse.json({
      ok: false,
      erro: 'Este rascunho não tem título nem ficha técnica — não há do que partir para reescrever.',
    }, { status: 400 })
  }

  // O que NÃO pode aparecer no texto novo. Vai explícito no prompt em vez de
  // ser filtrado só depois: é mais confiável pedir para não escrever do que
  // caçar no resultado.
  const proibidos = [origem.marca, rascunho.origem_vendedor]
    .filter(Boolean).map((s: string) => `"${s}"`).join(', ')

  const prompt = `Você escreve anúncios de e-commerce em português do Brasil para uma loja.

Escreva um TÍTULO e uma DESCRIÇÃO NOVOS para o produto abaixo.

REGRAS OBRIGATÓRIAS:
1. Não copie frases do texto de referência. Escreva com suas próprias palavras, partindo dos fatos da ficha técnica.
2. Não cite nenhum destes nomes: ${proibidos || '(nenhum)'}.
3. Não cite nomes de marketplaces (Mercado Livre, Shopee, Amazon, Magalu etc.).
4. Não prometa frete, prazo de entrega, parcelamento, garantia nem devolução — isso é política da loja, não característica do produto.
5. Não invente medida, material, potência, voltagem, quantidade nem certificação que não esteja na ficha técnica.
6. ${produto?.marca ? `A marca do produto é "${produto.marca}". Use essa e nenhuma outra.` : 'Não afirme marca nenhuma.'}
7. Título: no máximo ${MAX_TITULO} caracteres. Comece pelo tipo do produto. Use caixa normal — primeira letra maiúscula, siglas como LED, PVC, ABS e INOX em maiúsculas. Nunca escreva o título inteiro em maiúsculas nem inteiro em minúsculas. Sem emoji e sem ponto final.
8. Descrição: entre 400 e 1200 caracteres, em parágrafos curtos, tom direto e informativo. Pode usar uma lista de características. Sem emoji.
9. Não escreva frase de propaganda sobre a marca ("qualidade e confiança", "líder de mercado"). Fale do produto, não da marca.

PRODUTO
Nome no catálogo da loja: ${produto?.nome ?? '(ainda não vinculado)'}
Título de referência: ${origem.titulo ?? '(sem título)'}
Categoria: ${origem.categoriaAparente ?? '(não informada)'}
Condição: ${origem.condicao ?? 'novo'}

FICHA TÉCNICA (fonte principal — use estes dados)
${atributos || '(sem ficha técnica)'}

TEXTO DE REFERÊNCIA (apenas para entender o produto — NÃO copie)
${(origem.descricao ?? '').slice(0, LIMITE_DESCRICAO_ENTRADA) || '(sem descrição)'}

Responda SOMENTE com JSON: {"titulo": "...", "descricao": "..."}`

  let resposta: any
  try {
    resposta = await perguntarJSON(prompt)
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: `Falha ao gerar o texto: ${e?.message ?? e}` }, { status: 502 })
  }

  const titulo = texto(resposta?.titulo, MAX_TITULO)
  // A descrição mantém as quebras de linha — parágrafo é parte do resultado.
  const descricaoBruta = typeof resposta?.descricao === 'string' ? resposta.descricao.trim() : ''
  const descricao = descricaoBruta ? descricaoBruta.slice(0, MAX_DESCRICAO) : null

  if (!titulo || !descricao) {
    return NextResponse.json({ ok: false, erro: 'A resposta veio incompleta. Tente de novo.' }, { status: 502 })
  }

  // Rede de segurança: se um nome proibido escapou, o operador precisa saber
  // antes de publicar — não devolvo em silêncio fingindo que está limpo.
  const vazou = [origem.marca, rascunho.origem_vendedor]
    .filter(Boolean)
    .filter((n: string) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${titulo} ${descricao}`))

  return NextResponse.json({
    ok: true,
    titulo,
    descricao,
    // Nada é salvo aqui: o texto volta para a tela e só entra no rascunho se
    // o operador salvar. Sugestão de IA não deve virar dado sozinha.
    vazou,
  })
}
