import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { ajustarQuantidadeEndereco } from '@/lib/enderecamento/estoque'

export const dynamic = 'force-dynamic'

// Ajuste/contagem manual de quantidade num endereço — inclui "endereçar" um
// produto pela primeira vez (linha ainda não existe, novaQuantidade > 0).

type Corpo = {
  depositoId?: string
  enderecoId?: string
  produtoId?: string
  novaQuantidade?: number
  motivo?: string
}

export async function POST(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_estoque')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const body = await req.json().catch(() => ({})) as Corpo
  const { depositoId, enderecoId, produtoId, novaQuantidade } = body
  if (!depositoId || !enderecoId || !produtoId || novaQuantidade === undefined) {
    return NextResponse.json({ ok: false, erro: 'Depósito, endereço, produto e quantidade são obrigatórios.' }, { status: 400 })
  }

  const { data: deposito } = await sb.from('depositos').select('id').eq('id', depositoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!deposito) return NextResponse.json({ ok: false, erro: 'Depósito inválido.' }, { status: 400 })

  const { data: produto } = await sb.from('produtos').select('id, nome').eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado.' }, { status: 400 })

  const resultado = await ajustarQuantidadeEndereco(sb, {
    empresaId: guarda.empresaId, depositoId, enderecoId, produtoId, produtoNome: produto.nome,
    novaQuantidade, usuario: guarda.userId, motivo: body.motivo || null,
  })

  if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })
  return NextResponse.json({ ...resultado })
}
