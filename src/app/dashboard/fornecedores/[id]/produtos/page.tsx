import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import ProdutosDoFornecedorClient from '@/components/fornecedores/ProdutosDoFornecedorClient'

export const dynamic = 'force-dynamic'

// Produtos que este fornecedor já entregou, com o histórico calculado pela
// rodada noturna (custo, prazo real) e os campos que só o comprador decide
// (quantidade mínima, múltiplo de caixa, prazo cadastrado, preferência).

export default async function ProdutosDoFornecedorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: fornecedorId } = await params

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: fornecedor } = await sb.from('fornecedores')
    .select('id, razao_social, nome_fantasia, prazo_entrega_dias')
    .eq('id', fornecedorId).eq('empresa_id', empresaId).maybeSingle()
  if (!fornecedor) notFound()

  const { data: linhas, error } = await sb.from('fornecedor_produto')
    .select('id, produto_id, custo_ultimo, custo_medio, quantidade_ultima, ultima_compra_em, compras_contadas, prazo_entrega_real_dias, prazo_entrega_dias, quantidade_minima, multiplo_embalagem, preferencial, observacao')
    .eq('empresa_id', empresaId).eq('fornecedor_id', fornecedorId)
    .order('ultima_compra_em', { ascending: false })

  const ids = (linhas ?? []).map(l => l.produto_id)
  const produtos: Record<string, { nome: string; sku: string | null; estoque: number }> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('produtos').select('id, nome, sku, estoque').in('id', ids.slice(i, i + 200))
    for (const p of data ?? []) produtos[p.id] = { nome: p.nome, sku: p.sku, estoque: Number(p.estoque ?? 0) }
  }

  const lista = (linhas ?? []).map(l => ({
    ...l,
    nome: produtos[l.produto_id]?.nome ?? '(produto removido)',
    sku: produtos[l.produto_id]?.sku ?? null,
    estoque: produtos[l.produto_id]?.estoque ?? 0,
  }))

  return (
    <ProdutosDoFornecedorClient
      fornecedor={fornecedor}
      lista={lista}
      erro={error?.message ?? null}
    />
  )
}
