import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { sugerirFornecedor, type OpcaoFornecedor } from '@/lib/fornecedores/sugestao'

export const dynamic = 'force-dynamic'

// Fornecedores históricos de um produto, com sugestão.
//
// Consultado sob demanda (quando o comprador expande uma linha no
// Auxiliar de Compras) — não faz sentido materializar isto por produto,
// já que só uma fração da lista chega a ser aberta numa sessão.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: produtoId } = await params

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const perfil = await perfilDaSessao(sb, user.id)
  const empresaId = perfil?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 400 })

  const { data: linhas, error } = await sb.from('fornecedor_produto')
    .select('id, fornecedor_id, custo_ultimo, custo_medio, custo_menor_recente, custo_maior_recente, quantidade_ultima, ultima_compra_em, compras_contadas, prazo_entrega_real_dias, prazo_entrega_dias, quantidade_minima, multiplo_embalagem, preferencial, observacao')
    .eq('empresa_id', empresaId).eq('produto_id', produtoId)
    .order('ultima_compra_em', { ascending: false })

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 400 })
  if (!linhas || linhas.length === 0) return NextResponse.json({ ok: true, fornecedores: [], recomendado: null })

  const fornecedorIds = linhas.map(l => l.fornecedor_id)
  const { data: fornecedores } = await sb.from('fornecedores')
    .select('id, razao_social, nome_fantasia, prazo_entrega_dias')
    .in('id', fornecedorIds)
  const nomeDoFornecedor = new Map((fornecedores ?? []).map(f => [f.id, f.nome_fantasia || f.razao_social]))
  const prazoCadastradoDoFornecedor = new Map((fornecedores ?? []).map(f => [f.id, f.prazo_entrega_dias]))

  const opcoes: OpcaoFornecedor[] = linhas.map(l => {
    const prazoReal = l.prazo_entrega_real_dias !== null
    const prazoDias = l.prazo_entrega_real_dias ?? l.prazo_entrega_dias ?? prazoCadastradoDoFornecedor.get(l.fornecedor_id) ?? null
    return {
      fornecedorId: l.fornecedor_id,
      nome: nomeDoFornecedor.get(l.fornecedor_id) ?? 'Fornecedor',
      custoUltimo: l.custo_ultimo,
      prazoDias,
      prazoReal,
      comprasContadas: l.compras_contadas,
      ultimaCompraEm: l.ultima_compra_em,
      preferencial: l.preferencial,
      quantidadeMinima: l.quantidade_minima,
    }
  })

  const recomendacao = sugerirFornecedor(opcoes)

  return NextResponse.json({
    ok: true,
    fornecedores: linhas.map(l => ({ ...l, nome: nomeDoFornecedor.get(l.fornecedor_id) ?? 'Fornecedor' })),
    recomendado: recomendacao,
  })
}
