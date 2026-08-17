import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Editar os campos que só o comprador decide: prazo de entrega, quantidade
// mínima, múltiplo de embalagem, preferência.
//
// A rodada noturna (recalcularFornecedorProduto) nunca escreve nestes
// campos — só nos calculados (custo, última compra). Por isso esta rota
// faz upsert só do que veio no corpo, e não da linha inteira: sobrescrever
// tudo apagaria o cálculo da próxima vez que o comprador salvasse um único
// campo manual.

type Corpo = {
  fornecedorId?: string
  produtoId?: string
  prazoEntregaDias?: number | null
  quantidadeMinima?: number | null
  multiploEmbalagem?: number | null
  preferencial?: boolean
  observacao?: string | null
}

export async function PATCH(req: Request) {
  const body = await req.json() as Corpo
  const { fornecedorId, produtoId } = body

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  if (!fornecedorId || !produtoId) {
    return NextResponse.json({ ok: false, erro: 'Fornecedor e produto são obrigatórios.' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
  if ('prazoEntregaDias' in body) patch.prazo_entrega_dias = body.prazoEntregaDias
  if ('quantidadeMinima' in body) patch.quantidade_minima = body.quantidadeMinima
  if ('multiploEmbalagem' in body) patch.multiplo_embalagem = body.multiploEmbalagem
  if ('preferencial' in body) patch.preferencial = body.preferencial
  if ('observacao' in body) patch.observacao = body.observacao

  // Preferencial é exclusivo: só um fornecedor por produto. Sem isso, dois
  // marcados como preferido empatariam na sugestão e voltaríamos a não
  // saber qual escolher.
  if (patch.preferencial === true) {
    await sb.from('fornecedor_produto')
      .update({ preferencial: false })
      .eq('empresa_id', empresaId).eq('produto_id', produtoId).neq('fornecedor_id', fornecedorId)
  }

  const { error } = await sb.from('fornecedor_produto')
    .upsert(
      { empresa_id: empresaId, fornecedor_id: fornecedorId, produto_id: produtoId, ...patch },
      { onConflict: 'empresa_id,fornecedor_id,produto_id' },
    )

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
