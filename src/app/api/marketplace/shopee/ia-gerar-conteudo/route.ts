import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perguntarJSON, MODELO_FORTE } from '@/lib/ia/claude'
import { instrucaoTitulos, validarTitulos } from '@/lib/ia/tituloAnuncio'
import { buscarPadraoAnuncio, blocoPadraoAnuncio } from '@/lib/ia/padraoAnuncio'

const MAX_TITULO_SHOPEE = 120

type AtributoInput = {
  attribute_id: number; attribute_name: string; is_mandatory: boolean
  attribute_value_list: { value_id: number; original_value_name: string; filhos?: AtributoInput[] }[]
}
type MarcaInput = { brand_id: number; original_brand_name: string }

export async function POST(req: Request) {
  const { produtoNome, produtoMarca, categoriaPath, atributos, marcas } = await req.json() as {
    produtoNome: string; produtoMarca?: string | null; categoriaPath: string
    atributos: AtributoInput[]; marcas: MarcaInput[]
  }
  if (!produtoNome || !categoriaPath) return NextResponse.json({ ok: false, erro: 'produtoNome/categoriaPath ausente' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const padrao = profile?.empresa_id ? await buscarPadraoAnuncio(sb, profile.empresa_id) : null

  // Atributos-filho entram na lista com recuo: são obrigatórios só quando o
  // valor do pai que os revela for escolhido, e a IA precisa enxergar essa
  // dependência para não sugerir um sem o outro.
  function listarAtributos(lista: AtributoInput[], recuo = ''): string {
    return lista.map(a => {
      const valores = a.attribute_value_list.length > 0
        ? ` — opções: ${a.attribute_value_list.map(v => `${v.value_id}=${v.original_value_name}`).join(', ')}`
        : ' — campo de texto livre'
      const linha = `${recuo}- id ${a.attribute_id}: "${a.attribute_name}" (${a.is_mandatory ? 'OBRIGATÓRIO' : 'opcional'})${valores}`
      const filhos = a.attribute_value_list
        .filter(v => v.filhos?.length)
        .map(v => `${recuo}  se escolher "${v.original_value_name}", também pede:\n${listarAtributos(v.filhos!, `${recuo}    `)}`)
      return [linha, ...filhos].join('\n')
    }).join('\n')
  }
  const atributosTexto = listarAtributos(atributos ?? [])

  const marcasTexto = (marcas ?? []).map(m => `${m.brand_id}=${m.original_brand_name}`).join(', ')

  const prompt = `Você está preenchendo um anúncio de e-commerce na Shopee pra uma loja brasileira.

Produto: "${produtoNome}"${produtoMarca ? ` — marca cadastrada na loja: ${produtoMarca}` : ''}
Categoria escolhida na Shopee: ${categoriaPath}

${atributos?.length ? `Atributos que a categoria pede:\n${atributosTexto}\n` : 'Esta categoria não tem atributos.'}
${marcas?.length ? `Marcas aceitas nesta categoria (escolha uma pelo id se fizer sentido, senão não inclua "brand_id" na resposta): ${marcasTexto}\n` : ''}

${instrucaoTitulos(MAX_TITULO_SHOPEE)}
${blocoPadraoAnuncio(padrao)}

Responda SOMENTE com um JSON neste formato exato:
{
  "titulos": ["<opção 1>", "<opção 2>", "<opção 3>"],
  "descricao": "texto de descrição do anúncio em português, vendedor, 2 a 4 parágrafos curtos, sem inventar características que não foram informadas",
  "atributos": { "<attribute_id>": { "value_id": <id, se a opção tiver lista> } ou { "texto": "<valor>", "se for campo livre" } , ... só inclua os que você tem confiança razoável },
  "brand_id": <id da marca, opcional>
}

Não invente atributos com id fora da lista acima. Pra atributos com lista de opções, use exatamente um dos value_id informados — nunca invente um id que não está na lista. Se não tiver informação suficiente pra decidir um atributo (obrigatório ou não), simplesmente não inclua ele no JSON — não adivinhe.`

  try {
    // Modelo forte: escrever título de venda que expande abreviação, acerta
    // acentuação e ainda diferencia o anúncio é redação, não preenchimento.
    const resultado = await perguntarJSON(prompt, MODELO_FORTE)

    // Validação: nunca confia cegamente no que a IA devolveu — filtra pra só
    // aceitar attribute_id conhecidos e, no caso de listas, value_id que
    // realmente existem na lista da categoria (evita um add_item quebrado
    // por causa de um id inventado).
    const atributosValidados: Record<string, { valueId?: number; texto?: string }> = {}
    const atributosBrutos = resultado?.atributos ?? {}
    for (const [attrIdStr, valor] of Object.entries(atributosBrutos)) {
      const attr = (atributos ?? []).find(a => String(a.attribute_id) === String(attrIdStr))
      if (!attr) continue
      const v = valor as any
      if (attr.attribute_value_list.length > 0) {
        const valueId = Number(v?.value_id)
        if (attr.attribute_value_list.some(opt => opt.value_id === valueId)) {
          atributosValidados[attrIdStr] = { valueId }
        }
      } else if (typeof v?.texto === 'string' && v.texto.trim()) {
        atributosValidados[attrIdStr] = { texto: v.texto.trim().slice(0, 500) }
      }
    }

    let brandId: number | undefined
    if (resultado?.brand_id != null && (marcas ?? []).some(m => m.brand_id === Number(resultado.brand_id))) {
      brandId = Number(resultado.brand_id)
    }

    return NextResponse.json({
      ok: true,
      titulos: validarTitulos(resultado?.titulos, MAX_TITULO_SHOPEE),
      descricao: typeof resultado?.descricao === 'string' ? resultado.descricao.trim() : '',
      atributos: atributosValidados,
      brandId,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao gerar conteúdo com IA' }, { status: 400 })
  }
}
