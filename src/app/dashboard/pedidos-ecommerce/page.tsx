import { createClient } from '@/lib/supabase/server'
import PedidosEcommerceClient from '@/components/marketplaces/PedidosEcommerceClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function PedidosEcommercePage({ searchParams }: {
  searchParams: Promise<{ status?: string; q?: string; canalId?: string }>
}) {
  const { status = '', q = '', canalId = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: canais } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  // Empresa que debita estoque e empresa que emite fiscal — config da
  // conta (Empresas → Estoque/Fiscal), mesma resolução usada no PDV web.
  // Igual pra toda linha da listagem hoje (não existe override por canal).
  const [{ data: configEstoque }, { data: configFiscal }] = await Promise.all([
    supabase.from('empresa_config_estoque').select('empresa_estoque_id').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresa_config_fiscal').select('empresa_fiscal_id').eq('empresa_id', empresaId).maybeSingle(),
  ])
  const empresaEstoqueId = configEstoque?.empresa_estoque_id || empresaId
  const empresaFiscalId = configFiscal?.empresa_fiscal_id || empresaId
  const idsParaNome = [...new Set([empresaEstoqueId, empresaFiscalId])]
  const { data: empresasNomes } = await supabase.from('empresas').select('id, nome, nome_fantasia').in('id', idsParaNome)
  const nomePorId = new Map((empresasNomes ?? []).map(e => [e.id, e.nome_fantasia ?? e.nome]))
  const empresaEstoqueNome = nomePorId.get(empresaEstoqueId) ?? ''
  const empresaFiscalNome = nomePorId.get(empresaFiscalId) ?? ''

  let query = supabase
    .from('marketplace_pedidos')
    .select('*, marketplace_pedido_itens(*, produtos(nome, sku), marketplace_anuncios(imagens)), marketplace_pedido_pacotes(*), marketplace_canais(id, nome, plataforma)')
    .eq('empresa_id', empresaId)
    .order('data_pedido', { ascending: false })

  if (status) query = query.eq('status', status)
  if (canalId) query = query.eq('canal_id', canalId)
  if (q) query = query.or(`cliente_nome.ilike.%${q}%,numero_pedido.ilike.%${q}%,id_externo.ilike.%${q}%`)

  const { data: pedidos } = await query.limit(200)

  // Contagem real (sem o .limit acima) — o número exibido no cabeçalho não
  // pode depender do tamanho da página carregada, senão "sobe e desce"
  // conforme a base cresce além do limite, do jeito que confundiu antes.
  let countQuery = supabase
    .from('marketplace_pedidos')
    .select('*', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
  if (status) countQuery = countQuery.eq('status', status)
  if (canalId) countQuery = countQuery.eq('canal_id', canalId)
  if (q) countQuery = countQuery.or(`cliente_nome.ilike.%${q}%,numero_pedido.ilike.%${q}%,id_externo.ilike.%${q}%`)
  const { count: totalReal } = await countQuery

  return (
    <PedidosEcommerceClient
      canais={canais ?? []}
      pedidos={pedidos ?? []}
      totalReal={totalReal ?? (pedidos ?? []).length}
      empresaId={empresaId}
      empresaEstoqueNome={empresaEstoqueNome}
      empresaFiscalNome={empresaFiscalNome}
      statusInicial={status}
      qInicial={q}
      canalIdInicial={canalId}
      operador={user?.email ?? ''}
    />
  )
}
