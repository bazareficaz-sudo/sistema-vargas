import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perguntarJSONComImagens, MODELO_FORTE } from '@/lib/ia/claude'
import { baixarParaVisao } from '@/lib/imagens/paraVisao'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Conferência das imagens capturadas.
//
// A tela já avisava o operador para olhar imagem por imagem antes de marcar,
// porque foto de anúncio de terceiro costuma trazer marca d'água, logotipo ou
// telefone da loja de origem — e isso não pode ir para o anúncio da loja. O
// aviso estava certo e o trabalho era todo manual, com dez ou mais fotos por
// rascunho.
//
// Aqui a IA faz a primeira passada e diz de qual desconfiar. Ela NÃO decide
// nada: nenhuma imagem é marcada, desmarcada ou alterada por causa desta
// resposta — o resultado é um alerta na tela, e quem escolhe continua sendo o
// operador. É de propósito: acusar uma foto limpa custa uma foto boa a menos,
// e deixar passar uma suja custa um anúncio com telefone de concorrente.
//
// O modelo lê imagem, não desenha. Gerar ou editar foto não existe na API da
// Anthropic — quem precisar disso vai precisar de outro fornecedor.

/** Teto por rodada: acima disso a chamada fica cara e lenta sem ganho real. */
const MAX_IMAGENS = 12

const PROBLEMAS_CONHECIDOS = [
  'marca_dagua', 'logotipo', 'telefone', 'texto_promocional',
  'colagem', 'outro_produto', 'baixa_qualidade',
] as const

type Achado = {
  indice: number
  problemas: string[]
  observacao: string | null
  serveDeCapa: boolean
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: rascunho, error } = await sb
    .from('anuncio_rascunhos')
    .select('id, origem_vendedor, dados_origem')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  if (!rascunho) return NextResponse.json({ ok: false, erro: 'Rascunho não encontrado' }, { status: 404 })

  const origem = (rascunho.dados_origem ?? {}) as any
  // As imagens vêm do rascunho, não do corpo do pedido: o cliente não escolhe
  // qual endereço a IA vai abrir.
  const todas: string[] = Array.isArray(origem.imagens)
    ? origem.imagens.filter((u: unknown) => typeof u === 'string' && /^https?:\/\//i.test(u))
    : []

  if (todas.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Este rascunho não tem imagem capturada para conferir.' }, { status: 400 })
  }

  const candidatas = todas.slice(0, MAX_IMAGENS)

  // Baixa e reduz antes de subir. Imagem que não abre sai da lista aqui, e a
  // numeração que o modelo vê é a das que sobraram — por isso `urls` é
  // recalculado, e não a fatia original.
  const baixadas = await Promise.all(candidatas.map(async url => ({ url, img: await baixarParaVisao(url) })))
  const utilizaveis = baixadas.filter(b => b.img != null)
  const urls = utilizaveis.map(b => b.url)
  const falharamNoDownload = candidatas.length - utilizaveis.length
  const naoAnalisadas = (todas.length - candidatas.length) + falharamNoDownload

  if (urls.length === 0) {
    return NextResponse.json({
      ok: false,
      erro: 'Nenhuma das imagens pôde ser baixada para conferência — o site de origem pode ter saído do ar.',
    }, { status: 502 })
  }

  const prompt = `Você está conferindo as fotos de um anúncio que foram capturadas do site de outro vendedor${rascunho.origem_vendedor ? ` (vendedor de origem: "${rascunho.origem_vendedor}")` : ''}. Elas serão reaproveitadas no anúncio de outra loja.

Para CADA imagem numerada acima, diga o que você VÊ nela — sem adivinhar. Procure especificamente:

- "marca_dagua": marca d'água, selo translúcido ou nome repetido por cima da foto
- "logotipo": logo ou nome de loja, marketplace ou vendedor aplicado sobre a imagem
- "telefone": telefone, WhatsApp, e-mail, endereço, @ de rede social ou site escrito na imagem
- "texto_promocional": preço, desconto, "frete grátis", "promoção", selo de garantia ou qualquer texto de propaganda aplicado sobre a foto
- "colagem": montagem com vários quadros, setas, balões ou texto explicativo em cima da foto
- "outro_produto": a foto mostra outro produto, um acessório que não é o item, ou uma cena onde o produto nem aparece
- "baixa_qualidade": foto borrada, escura, esticada, muito pequena ou com o produto cortado

REGRAS:
- Só aponte o que está VISÍVEL na imagem. Não deduza por contexto e não invente texto que você não consegue ler.
- Texto que faz parte do próprio produto ou da embalagem (nome do fabricante impresso no rótulo, informação técnica na caixa) NÃO é marca d'água nem logotipo aplicado — não aponte.
- Se a imagem estiver limpa, devolva "problemas": [] para ela. É um resultado normal e esperado, não uma falha sua.
- "serveDeCapa": true apenas para foto limpa, com o produto inteiro, centralizado e em fundo claro ou neutro — o tipo de foto que funciona como primeira imagem numa vitrine.

Responda SOMENTE com um JSON neste formato exato:
{
  "imagens": [
    { "indice": 1, "problemas": ["marca_dagua"], "observacao": "texto curto dizendo o que aparece e onde", "serveDeCapa": false }
  ],
  "melhorCapa": 3
}

"indice" é o número da imagem como rotulado acima, começando em 1. Inclua uma entrada para cada imagem. "observacao" no máximo 120 caracteres, em português, e só quando houver algo a dizer — use null quando a imagem estiver limpa. "melhorCapa" é o índice da melhor foto para capa, ou null se nenhuma servir.`

  let resposta: any
  try {
    // Modelo forte: distinguir logo aplicado por cima da foto de nome impresso
    // na própria embalagem é exatamente o tipo de leitura em que o modelo mais
    // fraco erra — e errar aqui joga fora foto boa ou aprova foto suja.
    resposta = await perguntarJSONComImagens(prompt, utilizaveis.map(b => b.img!), MODELO_FORTE)
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: `Falha ao conferir as imagens: ${e?.message ?? e}` }, { status: 502 })
  }

  const brutas = Array.isArray(resposta?.imagens) ? resposta.imagens : []
  const achados: Achado[] = []
  for (const item of brutas) {
    const indice = Number(item?.indice)
    // Índice fora da lista é resposta inventada — descarta em vez de casar com
    // a imagem errada, que seria pior que não responder.
    if (!Number.isInteger(indice) || indice < 1 || indice > urls.length) continue
    const problemas = Array.isArray(item?.problemas)
      ? item.problemas
          .map((p: unknown) => String(p).trim().toLowerCase())
          .filter((p: string) => (PROBLEMAS_CONHECIDOS as readonly string[]).includes(p))
      : []
    const obs = typeof item?.observacao === 'string' ? item.observacao.trim().slice(0, 120) : ''
    achados.push({
      indice,
      problemas,
      observacao: obs || null,
      serveDeCapa: item?.serveDeCapa === true,
    })
  }

  if (achados.length === 0) {
    return NextResponse.json({ ok: false, erro: 'A resposta veio vazia. Tente de novo.' }, { status: 502 })
  }

  const melhorCapaBruta = Number(resposta?.melhorCapa)
  const melhorCapa = Number.isInteger(melhorCapaBruta) && melhorCapaBruta >= 1 && melhorCapaBruta <= urls.length
    ? melhorCapaBruta : null

  return NextResponse.json({
    ok: true,
    // Os endereços viajam de volta para a tela casar cada achado com a imagem
    // certa, mesmo que a ordem mude por lá.
    imagens: achados.map(a => ({ ...a, url: urls[a.indice - 1] })),
    melhorCapaUrl: melhorCapa != null ? urls[melhorCapa - 1] : null,
    naoAnalisadas,
  })
}
