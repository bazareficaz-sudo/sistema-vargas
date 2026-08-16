import { createClient } from '@/lib/supabase/server'
import EntradasListClient from '@/components/entradas/EntradasListClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function EntradasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''
  const operador = user?.email ?? ''

  const { data: entradas } = await supabase
    .from('entradas')
    .select('id, numero_entrada, numero_nf, serie, data_emissao, data_entrada, valor_total, status, status_revisao, created_at, fornecedores(razao_social, nome_fantasia)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(200)

  const { data: fornecedores } = await supabase
    .from('fornecedores')
    .select('id, razao_social, nome_fantasia')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('razao_social')

  // Conta itens por entrada
  const { data: contagemItens } = await supabase
    .from('entrada_itens')
    .select('entrada_id')
    .in('entrada_id', (entradas ?? []).map(e => e.id))

  const itensMap: Record<string, number> = {}
  for (const row of contagemItens ?? []) {
    itensMap[row.entrada_id] = (itensMap[row.entrada_id] ?? 0) + 1
  }

  // Conta contas a pagar por entrada
  const { data: contagemContas } = await supabase
    .from('contas_pagar')
    .select('entrada_id')
    .in('entrada_id', (entradas ?? []).map(e => e.id))

  const contasMap: Record<string, number> = {}
  for (const row of contagemContas ?? []) {
    if (row.entrada_id) contasMap[row.entrada_id] = (contasMap[row.entrada_id] ?? 0) + 1
  }

  const lista = (entradas ?? []).map(e => ({
    ...e,
    qtd_itens: itensMap[e.id] ?? 0,
    total_contas: contasMap[e.id] ?? 0,
  }))

  // Pendências
  const confirmadas = lista.filter(e => e.status === 'confirmada')
  const pendencias = {
    rascunho:    lista.filter(e => e.status === 'rascunho').length,
    semRevisao:  confirmadas.filter(e => (e.status_revisao ?? 'pendente') === 'pendente').length,
    semContas:   confirmadas.filter(e => (contasMap[e.id] ?? 0) === 0).length,
  }

  return (
    <EntradasListClient
      entradas={lista as any}
      fornecedores={fornecedores ?? []}
      pendencias={pendencias}
      empresaId={empresaId}
      operador={operador}
    />
  )
}
