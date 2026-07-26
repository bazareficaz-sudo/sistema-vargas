import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perguntarJSON } from '@/lib/ia/claude'

// Sugestão por IA pra completar campos vazios do cadastro de produto, com
// base só no nome e no EAN — nunca inventa categoria/marca nova (só aceita
// se bater com uma já cadastrada na empresa) e valida formato de NCM/CEST/
// medidas antes de devolver, pro mesmo padrão de "whitelist" já usado nas
// rotas de IA da Shopee (ia-sugerir-categoria/ia-gerar-conteudo).
function numOuNull(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) && n > min && n <= max ? Math.round(n * 1000) / 1000 : null
}

// A IA às vezes devolve NCM/CEST como número JSON em vez de string (apesar
// do prompt pedir string) — checar só `typeof === 'string'` descartava esses
// casos silenciosamente. Aceita number ou string e normaliza pra dígitos.
function digitsOuNull(v: unknown, tamanho: number): string | null {
  if (v == null) return null
  const digitos = String(v).replace(/\D/g, '')
  return digitos.length === tamanho ? digitos : null
}

export async function POST(req: Request) {
  const { produtoNome, produtoEan } = await req.json()
  if (!produtoNome?.trim()) return NextResponse.json({ ok: false, erro: 'Nome do produto é obrigatório' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const [{ data: categorias }, { data: marcas }] = await Promise.all([
    sb.from('categorias').select('nome').eq('empresa_id', empresaId).eq('ativo', true),
    sb.from('marcas').select('nome').eq('empresa_id', empresaId).eq('ativo', true),
  ])

  const prompt = `Você ajuda a completar o cadastro de produtos de uma loja brasileira (bazar/variedades) num sistema de PDV.

Com base SÓ no nome do produto e (se houver) no código de barras EAN/GTIN abaixo, sugira dados pra completar o cadastro.

Nome do produto: "${produtoNome}"
EAN/GTIN: ${produtoEan?.trim() || 'não informado'}

Categorias já cadastradas nesta loja (escolha o nome exato de uma se fizer sentido; se nenhuma se encaixar, use null — NÃO invente uma categoria nova):
${(categorias ?? []).map(c => `- ${c.nome}`).join('\n') || '(nenhuma cadastrada ainda)'}

Marcas já cadastradas nesta loja (escolha o nome exato de uma se fizer sentido; se nenhuma se encaixar, use null — NÃO invente uma marca nova):
${(marcas ?? []).map(m => `- ${m.nome}`).join('\n') || '(nenhuma cadastrada ainda)'}

Responda SOMENTE com um JSON neste formato exato:
{
  "categoria": "<nome exato de uma categoria da lista acima, ou null>",
  "marca": "<nome exato de uma marca da lista acima, ou null>",
  "ncm": "<código NCM de 8 dígitos mais provável, SEMPRE como string entre aspas mesmo sendo só números, mantendo zeros à esquerda se houver, ou null se não tiver certeza>",
  "cest": "<código CEST de 7 dígitos, SEMPRE como string entre aspas mesmo sendo só números, mantendo zeros à esquerda se houver, APENAS se esse tipo de produto costuma ter substituição tributária — senão null>",
  "descricao_marketplace": "<descrição curta e vendável em português, 2 a 3 frases, pra exibir numa loja online/marketplace, ou null>",
  "peso_kg": <peso estimado do produto embalado, em kg, número, ou null>,
  "altura_cm": <altura estimada da embalagem em cm, número, ou null>,
  "largura_cm": <largura estimada da embalagem em cm, número, ou null>,
  "comprimento_cm": <comprimento estimado da embalagem em cm, número, ou null>
}

Se não tiver informação suficiente e confiável pra algum campo, use null nesse campo em vez de chutar um valor genérico.`

  try {
    const resultado = await perguntarJSON(prompt)

    const nomeCategoriaValido = typeof resultado?.categoria === 'string'
      ? (categorias ?? []).find(c => c.nome.toLowerCase() === resultado.categoria.toLowerCase())?.nome ?? null
      : null
    const nomeMarcaValido = typeof resultado?.marca === 'string'
      ? (marcas ?? []).find(m => m.nome.toLowerCase() === resultado.marca.toLowerCase())?.nome ?? null
      : null
    const ncmValido = digitsOuNull(resultado?.ncm, 8)
    const cestValido = digitsOuNull(resultado?.cest, 7)
    const descricao = typeof resultado?.descricao_marketplace === 'string'
      ? resultado.descricao_marketplace.trim().slice(0, 1000) || null
      : null

    return NextResponse.json({
      ok: true,
      categoria: nomeCategoriaValido,
      marca: nomeMarcaValido,
      ncm: ncmValido,
      cest: cestValido,
      descricao_marketplace: descricao,
      peso_kg: numOuNull(resultado?.peso_kg, 0, 200),
      altura_cm: numOuNull(resultado?.altura_cm, 0, 300),
      largura_cm: numOuNull(resultado?.largura_cm, 0, 300),
      comprimento_cm: numOuNull(resultado?.comprimento_cm, 0, 300),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e?.message ?? 'Erro ao consultar a IA' }, { status: 400 })
  }
}
