import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { adicionarQuantidadeEndereco } from '@/lib/enderecamento/estoque'

export const dynamic = 'force-dynamic'

// Soma quantidade recebida ao que o endereço já tiver — nunca sobrescreve
// (ver adicionarQuantidadeEndereco). Usado ao confirmar o endereço sugerido
// pra uma entrada, seja no painel pós-entrada ou em Produtos sem Endereço.

type Corpo = {
  depositoId?: string
  enderecoId?: string
  produtoId?: string
  quantidadeRecebida?: number
  motivo?: string
  referenciaTipo?: string
  referenciaId?: string
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const { depositoId, enderecoId, produtoId, quantidadeRecebida } = body
  if (!depositoId || !enderecoId || !produtoId || !quantidadeRecebida) {
    return NextResponse.json({ ok: false, erro: 'Depósito, endereço, produto e quantidade recebida são obrigatórios.' }, { status: 400 })
  }

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const { data: produto } = await sb.from('produtos').select('id, nome').eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado.' }, { status: 400 })

  const resultado = await adicionarQuantidadeEndereco(sb, {
    empresaId: guarda.empresaId, depositoId, enderecoId, produtoId, produtoNome: produto.nome,
    quantidadeRecebida, usuario: guarda.userId, motivo: body.motivo || null,
    referenciaTipo: body.referenciaTipo || null, referenciaId: body.referenciaId || null,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })
  return NextResponse.json({ ...resultado })
}
