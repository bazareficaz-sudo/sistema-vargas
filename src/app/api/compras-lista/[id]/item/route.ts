import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Editar ou remover um item da lista de compra: quantidade, fornecedor,
// observação. `[id]` aqui é o id da LISTA — o item vem no corpo — porque
// toda edição precisa confirmar que o item pertence a uma lista desta
// empresa antes de mexer nele.

async function empresaDaLista(sb: any, listaId: string): Promise<string | null> {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id
  if (!empresaId) return null
  const { data: lista } = await sb.from('compras_listas').select('id').eq('id', listaId).eq('empresa_id', empresaId).maybeSingle()
  return lista ? empresaId : null
}

type CorpoPatch = { itemId?: string; quantidade?: number; fornecedorId?: string | null; observacao?: string | null }

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listaId } = await params
  const { itemId, quantidade, fornecedorId, observacao } = await req.json() as CorpoPatch

  const sb = await createClient()
  const empresaId = await empresaDaLista(sb, listaId)
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Lista não encontrada.' }, { status: 404 })
  if (!itemId) return NextResponse.json({ ok: false, erro: 'Item não informado.' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (quantidade !== undefined) {
    if (!(quantidade > 0)) return NextResponse.json({ ok: false, erro: 'Quantidade precisa ser maior que zero.' }, { status: 400 })
    patch.quantidade = quantidade
  }
  if (fornecedorId !== undefined) patch.fornecedor_id = fornecedorId
  if (observacao !== undefined) patch.observacao = observacao

  const { error } = await sb.from('compras_lista_itens')
    .update(patch).eq('id', itemId).eq('lista_id', listaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listaId } = await params
  const { searchParams } = new URL(req.url)
  const itemId = searchParams.get('itemId')

  const sb = await createClient()
  const empresaId = await empresaDaLista(sb, listaId)
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Lista não encontrada.' }, { status: 404 })
  if (!itemId) return NextResponse.json({ ok: false, erro: 'Item não informado.' }, { status: 400 })

  const { error } = await sb.from('compras_lista_itens').delete().eq('id', itemId).eq('lista_id', listaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
