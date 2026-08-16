import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Cancelar e excluir pedido ao fornecedor.
//
// São coisas diferentes, e a diferença importa:
//
// - CANCELAR mantém a linha. Um pedido que já saiu para o fornecedor existiu
//   no mundo: ele viu, pode ter separado mercadoria, pode cobrar. Apagar essa
//   linha some com a explicação de por que o pedido nunca virou entrada.
//
// - EXCLUIR apaga de vez, e só vale para rascunho — pedido que nunca saiu
//   daqui. É o caso dos rascunhos gerados pela automação de compra que o
//   operador não quer, e que hoje se acumulam na lista sem saída.
//
// Os itens somem junto na exclusão por `on delete cascade` na tabela.

const STATUS_CANCELAVEIS = ['rascunho', 'em_cotacao', 'aguardando_aprovacao', 'enviado', 'parcialmente_recebido']

async function empresaDoUsuario(sb: any): Promise<string | null> {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const profile = await perfilDaSessao(sb, user.id)
  return profile?.empresa_id ?? null
}

/** Cancelar, ou reabrir um pedido cancelado. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { acao, motivo } = await req.json() as { acao: 'cancelar' | 'reabrir'; motivo?: string }

  const sb = await createClient()
  const empresaId = await empresaDoUsuario(sb)
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: pedido } = await sb.from('pedidos_compra')
    .select('id, numero, status').eq('id', id).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido) return NextResponse.json({ ok: false, erro: 'Pedido não encontrado' }, { status: 404 })

  if (acao === 'reabrir') {
    if (pedido.status !== 'cancelado') {
      return NextResponse.json({ ok: false, erro: 'Este pedido não está cancelado.' }, { status: 400 })
    }
    // Volta como rascunho, não para o status anterior: o pedido cancelado
    // pode ter ficado meses parado, e reabrir direto como "enviado" faria o
    // sistema afirmar que o fornecedor está com ele agora.
    const { error } = await sb.from('pedidos_compra')
      .update({ status: 'rascunho', cancelado_em: null, cancelado_motivo: null, updated_at: new Date().toISOString() })
      .eq('id', id).eq('empresa_id', empresaId)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, status: 'rascunho' })
  }

  if (pedido.status === 'recebido') {
    return NextResponse.json({
      ok: false,
      erro: 'Pedido já recebido não pode ser cancelado — a mercadoria entrou. Se foi devolvida, registre a devolução.',
    }, { status: 400 })
  }
  if (!STATUS_CANCELAVEIS.includes(pedido.status)) {
    return NextResponse.json({ ok: false, erro: `Pedido com status "${pedido.status}" não pode ser cancelado.` }, { status: 400 })
  }

  const { error } = await sb.from('pedidos_compra').update({
    status: 'cancelado',
    cancelado_em: new Date().toISOString(),
    cancelado_motivo: motivo?.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('empresa_id', empresaId)

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, status: 'cancelado' })
}

/** Excluir de vez — só rascunho ou pedido já cancelado. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sb = await createClient()
  const empresaId = await empresaDoUsuario(sb)
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: pedido } = await sb.from('pedidos_compra')
    .select('id, numero, status').eq('id', id).eq('empresa_id', empresaId).maybeSingle()
  if (!pedido) return NextResponse.json({ ok: false, erro: 'Pedido não encontrado' }, { status: 404 })

  // A trava é aqui, no servidor, e não só no botão da tela: um pedido enviado
  // ou recebido é parte do histórico de compra da loja.
  if (pedido.status !== 'rascunho' && pedido.status !== 'cancelado') {
    return NextResponse.json({
      ok: false,
      erro: 'Só rascunho ou pedido cancelado pode ser excluído. Cancele o pedido primeiro — assim fica o registro de que ele existiu.',
    }, { status: 400 })
  }

  const { error } = await sb.from('pedidos_compra').delete().eq('id', id).eq('empresa_id', empresaId)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
