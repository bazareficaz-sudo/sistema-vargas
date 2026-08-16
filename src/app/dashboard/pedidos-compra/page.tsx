import { createClient } from '@/lib/supabase/server'
import PedidosCompraListClient from '@/components/pedidos-compra/PedidosCompraListClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function PedidosCompraPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  // Sem o embed `fornecedores(...)`: nao existe chave estrangeira de
  // pedidos_compra.fornecedor_id para fornecedores.id, entao o PostgREST
  // recusava a consulta inteira ("Could not find a relationship") e a
  // listagem aparecia vazia mesmo com pedido salvo. O nome do fornecedor
  // e resolvido por um Map, mesmo padrao usado em outras telas desta base.
  const { data: pedidos, error: erroPedidos } = await supabase
    .from('pedidos_compra')
    .select('id, numero, status, data_pedido, previsao_entrega, total, subtotal, observacoes, created_at, fornecedor_id, cancelado_em, cancelado_motivo')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(200)

  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, nome_fantasia, razao_social')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome_fantasia')

  // Inclui inativos: um pedido antigo pode apontar para fornecedor ja
  // desativado, e o nome dele ainda precisa aparecer na listagem.
  const fornecedorIds = [...new Set((pedidos ?? []).map(p => p.fornecedor_id).filter(Boolean))]
  const { data: fornsDosPedidos } = fornecedorIds.length > 0
    ? await supabase.from('fornecedores').select('id, nome_fantasia, razao_social').in('id', fornecedorIds)
    : { data: [] as { id: string; nome_fantasia: string | null; razao_social: string | null }[] }
  const nomePorFornecedor = new Map((fornsDosPedidos ?? []).map(f => [f.id, f]))

  // Conta itens por pedido
  const pedidoIds = (pedidos ?? []).map(p => p.id)
  let itensCount: Record<string, number> = {}
  if (pedidoIds.length > 0) {
    const { data: cnts } = await supabase
      .from('pedidos_compra_itens')
      .select('pedido_id')
      .in('pedido_id', pedidoIds)
    for (const row of cnts ?? []) {
      itensCount[row.pedido_id] = (itensCount[row.pedido_id] ?? 0) + 1
    }
  }

  const pedidosMapped = (pedidos ?? []).map(p => {
    const forn = p.fornecedor_id ? nomePorFornecedor.get(p.fornecedor_id) : null
    return {
      ...p,
      fornecedores: forn ? { nome_fantasia: forn.nome_fantasia ?? '', razao_social: forn.razao_social ?? '' } : null,
      qtdItens: itensCount[p.id] ?? 0,
    }
  })

  return (
    <PedidosCompraListClient
      pedidos={pedidosMapped}
      fornecedores={fornecedores ?? []}
      empresaId={empresaId}
      erro={erroPedidos?.message ?? null}
    />
  )
}
