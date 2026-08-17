import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import ComprasListaClient from '@/components/compras-lista/ComprasListaClient'

export const dynamic = 'force-dynamic'

export default async function ComprasListaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: listaId } = await params

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: lista } = await sb.from('compras_listas')
    .select('id, nome, status, created_at').eq('id', listaId).eq('empresa_id', empresaId).maybeSingle()
  if (!lista) notFound()

  const { data: itens, error } = await sb.from('compras_lista_itens')
    .select('id, produto_id, quantidade, fornecedor_id, custo_unitario_estimado, observacao, motivo, pedido_compra_id, created_at')
    .eq('lista_id', listaId).is('pedido_compra_id', null)
    .order('created_at', { ascending: true })

  const produtoIds = [...new Set((itens ?? []).map(i => i.produto_id))]
  const produtos: Record<string, { nome: string; sku: string | null; estoque: number; unidade: string | null }> = {}
  for (let i = 0; i < produtoIds.length; i += 200) {
    const { data } = await sb.from('produtos').select('id, nome, sku, estoque, unidade').in('id', produtoIds.slice(i, i + 200))
    for (const p of data ?? []) produtos[p.id] = { nome: p.nome, sku: p.sku, estoque: Number(p.estoque ?? 0), unidade: p.unidade }
  }

  // Fornecedores possíveis: os já vistos nesta lista + os que têm histórico
  // com algum dos produtos + todos os fornecedores ativos (pra trocar à
  // vontade). Uma consulta só, e a tela decide quem mostrar primeiro.
  const { data: fornecedores } = await sb.from('fornecedores')
    .select('id, razao_social, nome_fantasia').eq('empresa_id', empresaId).eq('ativo', true)
    .order('nome_fantasia')

  const { data: historico } = produtoIds.length > 0
    ? await sb.from('fornecedor_produto')
        .select('produto_id, fornecedor_id, custo_ultimo, preferencial')
        .eq('empresa_id', empresaId).in('produto_id', produtoIds)
    : { data: [] as { produto_id: string; fornecedor_id: string; custo_ultimo: number | null; preferencial: boolean }[] }

  const lote = (itens ?? []).map(i => ({
    ...i,
    nome: produtos[i.produto_id]?.nome ?? '(produto removido)',
    sku: produtos[i.produto_id]?.sku ?? null,
    estoque: produtos[i.produto_id]?.estoque ?? 0,
    unidade: produtos[i.produto_id]?.unidade ?? 'un',
  }))

  return (
    <ComprasListaClient
      lista={lista}
      itens={lote}
      fornecedores={fornecedores ?? []}
      historicoPorProduto={historico ?? []}
      erro={error?.message ?? null}
    />
  )
}
