import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perguntarJSON } from '@/lib/ia/claude'
import { buscarPadraoAnuncio, blocoPadraoAnuncio } from '@/lib/ia/padraoAnuncio'
import { marcaNoNome } from '@/lib/anuncios/prontidao'
import { promptProntidao } from '@/lib/anuncios/iaProntidao'

// PREENCHER COM IA, EM LOTE — o que trava os anúncios: peso e medidas da
// embalagem, descrição e marca.
//
// A IA ESTIMA; quem confirma é a pessoa. Nada é gravado aqui — a rota só
// devolve sugestões, a tela as marca como "sugestão da IA" e o operador
// salva o que conferiu (rota /salvar). Peso e medidas de embalagem saem do
// tipo de produto (um disjuntor pesa ~0,1 kg numa caixinha de 9×2×8 cm);
// valores fora de faixa são descartados em vez de corrigidos.
//
// A marca não vem da IA: vem das marcas que a própria loja já usa, achadas
// no nome do produto — inventar marca é pior que deixar vazio.
export const maxDuration = 60

const POR_CHAMADA = 6

function numero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > min && n <= max ? Math.round(n * 1000) / 1000 : null
}

export async function POST(req: Request) {
  const { ids } = await req.json().catch(() => ({})) as { ids?: string[] }
  const lista = Array.isArray(ids) ? ids.filter(x => typeof x === 'string').slice(0, POR_CHAMADA) : []
  if (lista.length === 0) return NextResponse.json({ ok: false, erro: 'Selecione produtos' }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'editar_produtos')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const [{ data: produtos }, { data: marcasCad }, { data: marcasUsadas }, padrao] = await Promise.all([
    sb.from('produtos').select('id, nome, marca, categoria, descricao_marketplace, peso_kg, comprimento_cm, largura_cm, altura_cm')
      .eq('empresa_id', guarda.empresaId).in('id', lista),
    sb.from('marcas').select('nome').eq('empresa_id', guarda.empresaId).eq('ativo', true),
    sb.from('produtos').select('marca').eq('empresa_id', guarda.empresaId).not('marca', 'is', null).limit(5000),
    buscarPadraoAnuncio(sb, guarda.empresaId),
  ])
  if (!produtos?.length) return NextResponse.json({ ok: false, erro: 'Produtos não encontrados' }, { status: 404 })
  const marcas = [...new Set([...(marcasCad ?? []).map((m: any) => m.nome), ...(marcasUsadas ?? []).map((m: any) => m.marca)]
    .map(m => String(m ?? '').trim()).filter(Boolean))]

  const entrada = produtos.map((p: any) => ({ id: p.id, nome: p.nome, marca: p.marca ?? null, categoria: p.categoria ?? null }))
  const prompt = promptProntidao(entrada, blocoPadraoAnuncio(padrao))

  let itensIA: any[] = []
  let erroIA: string | null = null
  try {
    const r = await perguntarJSON(prompt)
    itensIA = Array.isArray(r?.itens) ? r.itens : []
  } catch (e: any) {
    erroIA = e?.message ?? 'falha na IA'
  }

  const porId = new Map(itensIA.map((i: any) => [String(i?.id), i]))
  const sugestoes = produtos.map((p: any) => {
    const ia = porId.get(p.id) ?? {}
    const descricao = typeof ia.descricao === 'string' ? ia.descricao.trim().slice(0, 1000) : ''
    return {
      id: p.id,
      peso_kg: numero(ia.peso_kg, 0, 150),
      comprimento_cm: numero(ia.comprimento_cm, 0, 300),
      largura_cm: numero(ia.largura_cm, 0, 300),
      altura_cm: numero(ia.altura_cm, 0, 300),
      descricao_marketplace: descricao.length >= 40 ? descricao : null,
      marca: p.marca ? null : marcaNoNome(p.nome, marcas),
    }
  })
  return NextResponse.json({ ok: true, sugestoes, erroIA })
}
