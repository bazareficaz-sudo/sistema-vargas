import { createClient } from '@/lib/supabase/server'
import NovoPedidoClient from '@/components/pedidos-compra/NovoPedidoClient'

export const dynamic = 'force-dynamic'

export default async function NovoPedidoPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  // Nome e CNPJ entram no cabeçalho do pedido impresso — documento que sai da
  // empresa precisa dizer de quem é.
  const { data: empresa } = empresaId
    ? await supabase.from('empresas').select('nome, cnpj, telefone').eq('id', empresaId).single()
    : { data: null }

  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, nome_fantasia, razao_social, email, telefone')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome_fantasia')

  let pedidoExistente = null
  let itensExistentes: unknown[] = []

  if (id) {
    const { data: ped } = await supabase
      .from('pedidos_compra')
      .select('*')
      .eq('id', id)
      .eq('empresa_id', empresaId)
      .single()
    pedidoExistente = ped

    // Sem o embed `produtos(...)`: nao existe chave estrangeira de
    // pedidos_compra_itens.produto_id para produtos.id, entao o PostgREST
    // recusava a consulta e o rascunho reabria com o carrinho vazio — os
    // itens estavam salvos, so nao chegavam na tela. Nome e SKU vem de uma
    // segunda consulta, casada por Map.
    const { data: itens } = await supabase
      .from('pedidos_compra_itens')
      .select('*')
      .eq('pedido_id', id)

    const produtoIds = [...new Set((itens ?? []).map(i => i.produto_id).filter(Boolean))]
    const { data: prods } = produtoIds.length > 0
      ? await supabase.from('produtos').select('id, nome, sku, unidade, preco_venda').in('id', produtoIds)
      : { data: [] as { id: string; nome: string; sku: string; unidade: string; preco_venda: number }[] }
    const produtoPorId = new Map((prods ?? []).map(p => [p.id, p]))

    itensExistentes = (itens ?? []).map(i => ({
      ...i,
      produtos: i.produto_id ? (produtoPorId.get(i.produto_id) ?? null) : null,
    }))
  }

  return (
    <NovoPedidoClient
      fornecedores={fornecedores ?? []}
      empresa={empresa ?? null}
      empresaId={empresaId}
      userId={user!.id}
      pedidoExistente={pedidoExistente}
      itensExistentes={itensExistentes}
    />
  )
}
