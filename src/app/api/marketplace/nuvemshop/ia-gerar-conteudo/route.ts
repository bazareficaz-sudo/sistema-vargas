import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perguntarJSON, MODELO_FORTE } from '@/lib/ia/claude'
import { instrucaoTitulos, validarTitulos } from '@/lib/ia/tituloAnuncio'
import { buscarPadraoAnuncio, blocoPadraoAnuncio } from '@/lib/ia/padraoAnuncio'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Irmã das rotas de IA de Shopee e Mercado Livre, com duas diferenças que vêm
// da natureza da loja própria:
//
// 1. Não há atributo de categoria para preencher — a taxonomia é da loja, não
//    da plataforma. Sobra o que realmente vende: título e descrição.
// 2. A descrição da Nuvemshop é renderizada como HTML na vitrine. Texto puro
//    vira um bloco corrido sem respiro; então aqui a IA devolve HTML simples,
//    e não parágrafos separados por quebra de linha como no ML.
//
// O título não tem corte duro como os 60 do ML, mas título quilométrico é
// ruim de ler na vitrine e no Google — 90 é um teto de bom senso, não uma
// exigência da API.
const MAX_TITULO_NUVEMSHOP = 90

// Marcação que a vitrine aceita sem quebrar o layout do tema. Tags fora desta
// lista saem do texto: a IA às vezes devolve <h1> ou <div style=...>, que
// competem com o título da página e com o CSS da loja.
const TAGS_PERMITIDAS = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'b', 'i']

function limparHtml(bruto: unknown): string {
  if (typeof bruto !== 'string') return ''
  return bruto
    .replace(/```html|```/g, '')
    .replace(/<\/?([a-zA-Z0-9]+)[^>]*>/g, (tagInteira, nome: string) => {
      const limpa = nome.toLowerCase()
      if (!TAGS_PERMITIDAS.includes(limpa)) return ''
      // Reescreve a tag sem atributo nenhum: some com style, class e onclick
      // de uma vez, em vez de tentar filtrar atributo por atributo.
      return tagInteira.startsWith('</') ? `</${limpa}>` : `<${limpa}>`
    })
    .trim()
}

export async function POST(req: Request) {
  const { produtoNome, produtoMarca, produtoCategoria, produtoDescricao, categoriasLoja } = await req.json() as {
    produtoNome: string
    produtoMarca?: string | null
    produtoCategoria?: string | null
    produtoDescricao?: string | null
    categoriasLoja?: string[]
  }
  if (!produtoNome) return NextResponse.json({ ok: false, erro: 'produtoNome ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const padrao = profile?.empresa_id ? await buscarPadraoAnuncio(sb, profile.empresa_id) : null

  const prompt = `Você está preenchendo o anúncio de um produto na loja virtual PRÓPRIA de uma loja brasileira de material de construção (plataforma Nuvemshop).

Produto: "${produtoNome}"${produtoMarca ? ` — marca: ${produtoMarca}` : ''}
${produtoCategoria ? `Categoria interna da loja: ${produtoCategoria}` : ''}
${produtoDescricao ? `Descrição já cadastrada: ${produtoDescricao}` : ''}
${categoriasLoja?.length ? `Categorias escolhidas na loja: ${categoriasLoja.join(', ')}` : ''}

Diferente de um marketplace, aqui não há concorrente na mesma página: quem chegou já está na loja. A descrição não precisa gritar, precisa tirar a dúvida que faz a pessoa desistir — o que é, onde se usa, o que vem junto.

${instrucaoTitulos(MAX_TITULO_NUVEMSHOP)}
${blocoPadraoAnuncio(padrao)}

Responda SOMENTE com um JSON neste formato exato:
{
  "titulos": ["<opção 1>", "<opção 2>", "<opção 3>"],
  "descricao": "<HTML simples>"
}

Regras da descrição:
- HTML simples, usando SOMENTE estas tags: <p>, <br>, <strong>, <em>, <ul>, <ol>, <li>. Sem atributo nenhum (nada de style, class ou id) e sem <h1>/<h2>, que brigam com o título da página.
- 2 a 4 parágrafos curtos, podendo terminar com uma lista curta de pontos objetivos.
- Português correto e acentuado, mesmo que o nome do produto venha abreviado e sem acento do cadastro interno.
- NUNCA invente medida, peso, rendimento, tempo de secagem, composição, voltagem, garantia ou certificação que não estejam informados acima. Na dúvida, escreva menos — dado errado em loja própria vira troca e reclamação direto com você.
- Não afirme estado de preparo ("pronto para uso", "já misturado", "não precisa diluir") nem desempenho (rendimento por metro, resistência, durabilidade). Isso muda de fabricante para fabricante e não está no cadastro. Medido: sem esta regra, uma argamassa em pó foi anunciada como "pronta para uso".
- Sem preço e sem prazo de entrega: os dois mudam e ficariam mentindo na página.`

  try {
    const resultado = await perguntarJSON(prompt, MODELO_FORTE)
    return NextResponse.json({
      ok: true,
      titulos: validarTitulos(resultado?.titulos, MAX_TITULO_NUVEMSHOP),
      descricao: limparHtml(resultado?.descricao),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao gerar conteúdo com IA' }, { status: 400 })
  }
}
