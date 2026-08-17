import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { resolverFornecedorSugerido } from '@/lib/comprasLista/resolverFornecedor'

export const dynamic = 'force-dynamic'

// Adicionar produtos (do Auxiliar de Compras, ou de qualquer lugar) a uma
// lista de compra.
//
// Sem `listaId`, usa a lista aberta da empresa — cria uma se não houver.
// Isso é o que permite ao comprador ir juntando sugestões ao longo do dia
// sem escolher lista toda vez: normalmente só existe uma "bancada" aberta.
//
// Item que já está na lista tem a quantidade SOMADA, não duplicada — dois
// cliques em "adicionar" no mesmo produto não devem virar duas linhas.

type ItemEntrada = { produtoId: string; quantidade: number; motivo?: string }
type Corpo = { listaId?: string; itens?: ItemEntrada[] }

export async function POST(req: Request) {
  const { listaId, itens } = await req.json() as Corpo

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id, 'empresa_id, nome')
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  if (!Array.isArray(itens) || itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Nenhum produto selecionado.' }, { status: 400 })
  }

  let lista: { id: string } | null = null
  if (listaId) {
    const { data } = await sb.from('compras_listas').select('id').eq('id', listaId).eq('empresa_id', empresaId).maybeSingle()
    lista = data
  }
  if (!lista) {
    const { data: aberta } = await sb.from('compras_listas')
      .select('id').eq('empresa_id', empresaId).eq('status', 'aberta')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    lista = aberta
  }
  if (!lista) {
    const nome = `Reposição ${new Date().toLocaleDateString('pt-BR')}`
    const { data: nova, error } = await sb.from('compras_listas')
      .insert({ empresa_id: empresaId, nome, criado_por: perfil?.nome ?? null })
      .select('id').single()
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
    lista = nova
  }

  const { data: existentes } = await sb.from('compras_lista_itens')
    .select('id, produto_id, quantidade').eq('lista_id', lista.id).is('pedido_compra_id', null)
  const porProduto = new Map((existentes ?? []).map(i => [i.produto_id, i]))

  let adicionados = 0, atualizados = 0
  for (const item of itens) {
    if (!item.produtoId || !(item.quantidade > 0)) continue
    const jaExiste = porProduto.get(item.produtoId)
    if (jaExiste) {
      await sb.from('compras_lista_itens')
        .update({ quantidade: Number(jaExiste.quantidade) + item.quantidade })
        .eq('id', jaExiste.id)
      atualizados++
      continue
    }

    const { fornecedorId, custoEstimado } = await resolverFornecedorSugerido(sb, empresaId, item.produtoId)
    const { error } = await sb.from('compras_lista_itens').insert({
      lista_id: lista.id, produto_id: item.produtoId, quantidade: item.quantidade,
      fornecedor_id: fornecedorId, custo_unitario_estimado: custoEstimado,
      origem: 'auxiliar', motivo: item.motivo ?? null,
    })
    if (!error) adicionados++
  }

  await sb.from('compras_listas').update({ updated_at: new Date().toISOString() }).eq('id', lista.id)

  return NextResponse.json({ ok: true, listaId: lista.id, adicionados, atualizados })
}
