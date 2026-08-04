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
// Guarda a URL, não uma cópia do arquivo — mesmo comportamento que o
// enriquecimento de produto por marketplace já usa hoje. Isso tem uma
// consequência que a tela precisa dizer: a imagem continua hospedada no site
// de origem, e se ela sair do ar, some do seu anúncio também.

const MAX = 20

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: rascunho, error } = await sb
    .from('anuncio_rascunhos')
    .select('id, produto_id, dados_editados')
    .eq('id', id).eq('empresa_id', guarda.empresaId).maybeSingle()

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  if (!rascunho) return NextResponse.json({ ok: false, erro: 'Rascunho não encontrado' }, { status: 404 })
  if (!rascunho.produto_id) {
    return NextResponse.json({ ok: false, erro: 'Vincule um produto antes de copiar as imagens.' }, { status: 400 })
  }

  const escolhidas: string[] = Array.isArray((rascunho.dados_editados as any)?.imagens)
    ? (rascunho.dados_editados as any).imagens.slice(0, MAX)
    : []
  if (escolhidas.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma imagem escolhida neste rascunho.' }, { status: 400 })
  }

  const { data: existentes } = await sb.from('produto_imagens')
    .select('url, ordem').eq('produto_id', rascunho.produto_id)

  const jaTem = new Set((existentes ?? []).map(i => i.url))
  const novas = escolhidas.filter(u => !jaTem.has(u))
  const base = existentes?.length ?? 0

  if (novas.length === 0) {
    return NextResponse.json({ ok: true, adicionadas: 0, jaExistiam: escolhidas.length })
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
  })
}
