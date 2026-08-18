import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { moverEntreEnderecos } from '@/lib/enderecamento/estoque'

export const dynamic = 'force-dynamic'

// "Transferir Endereço" — move quantidade entre dois endereços do MESMO
// depósito. Nunca mexe em produto_estoque/produtos.estoque (o total do
// depósito não muda).

type Corpo = {
  depositoId?: string
  enderecoOrigemId?: string
  enderecoDestinoId?: string
  produtoId?: string
  quantidade?: number
  observacao?: string
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const { depositoId, enderecoOrigemId, enderecoDestinoId, produtoId, quantidade } = body
  if (!depositoId || !enderecoOrigemId || !enderecoDestinoId || !produtoId || !quantidade) {
    return NextResponse.json({ ok: false, erro: 'Depósito, origem, destino, produto e quantidade são obrigatórios.' }, { status: 400 })
  }

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const { data: produto } = await sb.from('produtos').select('id, nome').eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado.' }, { status: 400 })

  const resultado = await moverEntreEnderecos(sb, {
    empresaId: guarda.empresaId, depositoId, enderecoOrigemId, enderecoDestinoId,
    produtoId, produtoNome: produto.nome, quantidade, usuario: guarda.userId, observacao: body.observacao || null,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })
  return NextResponse.json({ ...resultado })
}
