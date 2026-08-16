import { createClient } from '@/lib/supabase/server'
import ContasPagarClient from '@/components/ContasPagarClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function ContasPagarPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = 'pendente', q = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  // Atualiza status vencido automaticamente
  try { await supabase.rpc('atualizar_contas_vencidas') } catch {}

  let query = supabase
    .from('contas_pagar')
    .select('*, fornecedores(razao_social, nome_fantasia)')
    .eq('empresa_id', empresaId)
    .order('vencimento', { ascending: true })

  if (status !== 'todos') query = query.eq('status', status)
  if (q) query = query.ilike('descricao', `%${q}%`)

  const { data: contas } = await query.limit(200)

  // Totais
  const { data: totais } = await supabase
    .from('contas_pagar')
    .select('status, valor')
    .eq('empresa_id', empresaId)

  const totalPendente = (totais ?? []).filter(c => c.status === 'pendente').reduce((s, c) => s + Number(c.valor), 0)
  const totalVencido = (totais ?? []).filter(c => c.status === 'vencido').reduce((s, c) => s + Number(c.valor), 0)
  const totalPago = (totais ?? []).filter(c => c.status === 'pago').reduce((s, c) => s + Number(c.valor), 0)

  return (
    <ContasPagarClient
      contas={contas ?? []}
      statusFiltro={status}
      qInicial={q}
      empresaId={empresaId}
      totalPendente={totalPendente}
      totalVencido={totalVencido}
      totalPago={totalPago}
    />
  )
}
