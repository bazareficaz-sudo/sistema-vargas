import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'

export const dynamic = 'force-dynamic'

// Leva as imagens escolhidas no rascunho para o cadastro do produto.
//
// Por que isto existe: a tela de publicar monta o anúncio com as imagens do
// PRODUTO (`produto_imagens`), não com as do rascunho. Sem esta ponte, o
// operador escolheria imagens numa tela e elas não apareceriam na outra.
//
// A ponte era um botão, e por isso o caminho natural — escolher, salvar,
// marcar como pronto, publicar — chegava no marketplace com zero imagem. Hoje
// a tela de publicar chama esta rota sozinha, antes de abrir o modal; o botão
// continua existindo para quem quer mandar as fotos antes disso.
//
// O corpo pode trazer `imagens`: é a escolha que está NA TELA, que pode ser
// mais nova que a salva. Cada URL é conferida contra as que este rascunho
// conhece (as capturadas da origem e as que o operador subiu) — sem isso a
// rota viraria um jeito de gravar endereço arbitrário em produto_imagens.
//
// Guarda a URL, não uma cópia do arquivo — mesmo comportamento que o
// enriquecimento de produto por marketplace já usa hoje. Isso tem uma
// consequência que a tela precisa dizer: a imagem continua hospedada no site
// de origem, e se ela sair do ar, some do seu anúncio também.

const MAX = 20

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const corpo = await req.json().catch(() => null) as { imagens?: unknown } | null
  const daTela = Array.isArray(corpo?.imagens)
    ? corpo!.imagens.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : null
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: rascunho, error } = await sb
    .from('anuncio_rascunhos')
    .select('id, produto_id, dados_origem, dados_editados')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  if (!rascunho) return NextResponse.json({ ok: false, erro: 'Rascunho não encontrado' }, { status: 404 })
  if (!rascunho.produto_id) {
    return NextResponse.json({ ok: false, erro: 'Vincule um produto antes de copiar as imagens.' }, { status: 400 })
  }

  const editados = (rascunho.dados_editados ?? {}) as Record<string, unknown>
  const origem = (rascunho.dados_origem ?? {}) as Record<string, unknown>
  const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter(u => typeof u === 'string') : [])

  // Tudo que este rascunho legitimamente conhece: o que veio da captura e o
  // que o operador subiu ou colou nesta tela.
  const conhecidas = new Set([
    ...lista(origem.imagens),
    ...lista(editados.imagens),
    ...lista(editados.imagensProprias),
  ])

  const pedidas = daTela ?? lista(editados.imagens)
  const recusadas = daTela ? daTela.filter(u => !conhecidas.has(u)).length : 0
  const escolhidas = [...new Set(pedidas.filter(u => conhecidas.has(u)))].slice(0, MAX)

  if (escolhidas.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma imagem escolhida neste rascunho.' }, { status: 400 })
  }

  const { data: existentes } = await sb.from('produto_imagens')
    .select('url, ordem').eq('produto_id', rascunho.produto_id)

  const jaTem = new Set((existentes ?? []).map(i => i.url))
  const novas = escolhidas.filter(u => !jaTem.has(u))
  const base = existentes?.length ?? 0

  if (novas.length === 0) {
    return NextResponse.json({ ok: true, adicionadas: 0, jaExistiam: escolhidas.length, recusadas })
  }

  const { error: erroInsert } = await sb.from('produto_imagens').insert(
    novas.map((url, i) => ({
      empresa_id: guarda.empresaId,
      produto_id: rascunho.produto_id,
      url,
      ordem: base + i,
      // Só vira principal se o produto ainda não tinha imagem nenhuma —
      // trocar a capa de um produto já cadastrado não foi o que se pediu.
      principal: base === 0 && i === 0,
    })),
  )
  if (erroInsert) return NextResponse.json({ ok: false, erro: erroInsert.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    adicionadas: novas.length,
    jaExistiam: escolhidas.length - novas.length,
    recusadas,
  })
}
