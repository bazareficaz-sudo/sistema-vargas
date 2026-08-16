import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perguntarJSON, MODELO_FORTE } from '@/lib/ia/claude'
import { instrucaoTitulos, validarTitulos } from '@/lib/ia/tituloAnuncio'
import { buscarPadraoAnuncio, blocoPadraoAnuncio } from '@/lib/ia/padraoAnuncio'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// O Mercado Livre corta o titulo em 60 caracteres.
const MAX_TITULO_ML = 60

type AtributoInput = {
  id: string; name: string; obrigatorio: boolean; tipo: string
  valores: { id: string; name: string }[]
}

// Espelha src/app/api/marketplace/shopee/ia-gerar-conteudo/route.ts, adaptado
// ao formato de atributos do ML (id/name em vez de attribute_id numérico, e
// o valor final é sempre value_name — texto — mesmo pra atributos com lista
// fixa, já que é isso que criarAnuncio()/AtributoInputML esperam).
//
// Pede pra IA tentar preencher TODOS os atributos, não só os marcados como
// obrigatórios pela API de categoria — na prática o ML rejeita criação de
// item com "body.required_fields" citando atributos que a própria listagem
// de atributos não sinaliza como obrigatórios (ex: atributos condicionais).
// Preencher o máximo possível reduz a chance de bater nesse erro de novo.
export async function POST(req: Request) {
  const { produtoNome, produtoMarca, produtoDescricao, categoriaPath, atributos } = await req.json() as {
    produtoNome: string; produtoMarca?: string | null; produtoDescricao?: string | null
    categoriaPath: string; atributos: AtributoInput[]
  }
  if (!produtoNome || !categoriaPath) return NextResponse.json({ ok: false, erro: 'produtoNome/categoriaPath ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(sb, user.id)
  const padrao = profile?.empresa_id ? await buscarPadraoAnuncio(sb, profile.empresa_id) : null

  const atributosTexto = (atributos ?? []).map(a => {
    const valores = a.valores.length > 0
      ? ` — opções válidas (use o texto exato de uma delas): ${a.valores.map(v => `"${v.name}"`).join(', ')}`
      : ' — campo de texto livre'
    return `- id "${a.id}": "${a.name}" (${a.obrigatorio ? 'marcado como OBRIGATÓRIO' : 'marcado como opcional, mas tente preencher mesmo assim se der pra inferir com confiança'})${valores}`
  }).join('\n')

  const prompt = `Você está preenchendo um anúncio de e-commerce no Mercado Livre pra uma loja brasileira.

Produto: "${produtoNome}"${produtoMarca ? ` — marca cadastrada na loja: ${produtoMarca}` : ''}
${produtoDescricao ? `Descrição já cadastrada do produto: ${produtoDescricao}` : ''}
Categoria escolhida no Mercado Livre: ${categoriaPath}

${atributos?.length ? `Atributos que a categoria pede:\n${atributosTexto}\n` : 'Esta categoria não tem atributos.'}

O Mercado Livre às vezes rejeita a criação do anúncio citando atributos que nem apareceram como obrigatórios na lista acima (atributos condicionais). Por isso, tente preencher o MÁXIMO de atributos possível com confiança razoável — não só os marcados como obrigatórios — mas nunca invente um valor sem nenhuma base no nome/marca/descrição do produto.

${instrucaoTitulos(MAX_TITULO_ML)}
${blocoPadraoAnuncio(padrao)}

Responda SOMENTE com um JSON neste formato exato:
{
  "titulos": ["<opção 1>", "<opção 2>", "<opção 3>"],
  "descricao": "texto de descrição do anúncio em português, vendedor, 2 a 4 parágrafos curtos, sem inventar características que não foram informadas",
  "atributos": { "<id do atributo>": "<texto do valor — pra atributos com opções, use exatamente uma das strings da lista>", ... }
}

Não invente id de atributo fora da lista acima. Pra atributos com opções, o valor tem que ser exatamente igual (mesma grafia) a uma das opções informadas. Se não tiver informação suficiente pra decidir um atributo, simplesmente não inclua ele no JSON — não adivinhe.`

  try {
    // Modelo forte: titulo de venda e redacao, nao preenchimento de campo.
    const resultado = await perguntarJSON(prompt, MODELO_FORTE)

    // Nunca confia cegamente na IA: só aceita atributos com id conhecido, e
    // pra atributos com lista fixa exige match exato (case-insensitive) com
    // uma das opções reais — evita mandar pro ML um value_name inventado.
    const atributosValidados: Record<string, string> = {}
    const atributosBrutos = resultado?.atributos ?? {}
    for (const [attrId, valorBruto] of Object.entries(atributosBrutos)) {
      const attr = (atributos ?? []).find(a => a.id === attrId)
      if (!attr) continue
      const valor = String(valorBruto ?? '').trim()
      if (!valor) continue
      if (attr.valores.length > 0) {
        const match = attr.valores.find(v => v.name.toLowerCase() === valor.toLowerCase())
        if (match) atributosValidados[attrId] = match.name
      } else {
        atributosValidados[attrId] = valor.slice(0, 500)
      }
    }

    return NextResponse.json({
      ok: true,
      titulos: validarTitulos(resultado?.titulos, MAX_TITULO_ML),
      descricao: typeof resultado?.descricao === 'string' ? resultado.descricao.trim() : '',
      atributos: atributosValidados,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao gerar conteúdo com IA' }, { status: 400 })
  }
}
