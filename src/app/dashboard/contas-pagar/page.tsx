import { createClient } from '@/lib/supabase/server'
import ContasPagarClient from '@/components/ContasPagarClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { origemDaConta, pedidoDaConta, type DadosDaEntrada, type DadosDaNfe } from '@/lib/contas/origemDaConta'

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
    .select('*, fornecedores(id, razao_social, nome_fantasia)')
    .eq('empresa_id', empresaId)
    .order('vencimento', { ascending: true })

  if (status !== 'todos') query = query.eq('status', status)
  if (q) query = query.ilike('descricao', `%${q}%`)

  const { data: contas } = await query.limit(200)
  const lista = contas ?? []

  // ── Origem de cada conta ────────────────────────────────────────────────
  //
  // Duas consultas em vez de join aninhado porque são DUAS TABELAS de destino
  // e a escolha depende da linha: `entrada_id` aponta para `entradas`,
  // `origem_id` (com `origem='entrada_xml'`) aponta para `nfe_entradas`. Um
  // select aninhado do Supabase precisaria de relacionamento declarado para
  // cada uma, e `origem_id` é coluna solta — não tem FK.
  const entradaIds = [...new Set(lista.map(c => c.entrada_id).filter(Boolean))] as string[]
  const nfeIds = [...new Set(
    lista.filter(c => c.origem === 'entrada_xml').map(c => c.origem_id).filter(Boolean),
  )] as string[]

  const [{ data: entradas }, { data: nfes }] = await Promise.all([
    entradaIds.length
      ? supabase.from('entradas')
          .select('id, numero_nf, numero_entrada, observacoes, pedido_compra_id')
          .eq('empresa_id', empresaId).in('id', entradaIds)
      : Promise.resolve({ data: [] as DadosDaEntrada[] }),
    nfeIds.length
      ? supabase.from('nfe_entradas')
          .select('id, numero, serie')
          .eq('empresa_id', empresaId).in('id', nfeIds)
      : Promise.resolve({ data: [] as DadosDaNfe[] }),
  ])

  const porEntrada = new Map((entradas ?? []).map(e => [e.id, e as DadosDaEntrada]))
  const porNfe = new Map((nfes ?? []).map(n => [n.id, n as DadosDaNfe]))

  const contasComOrigem = lista.map(c => {
    const entrada = c.entrada_id ? porEntrada.get(c.entrada_id) ?? null : null
    return {
      ...c,
      origemDoc: origemDaConta(c, entrada, c.origem_id ? porNfe.get(c.origem_id) ?? null : null),
      pedidoDoc: pedidoDaConta(entrada),
      // A OBS DA ENTRADA VEM SEPARADA da observação da própria conta, e não
      // copiada por cima dela. São duas frases de autores diferentes: uma foi
      // escrita ao dar entrada na mercadoria, a outra por quem administra o
      // pagamento. Fundir as duas num campo só apagaria a mais antiga na
      // primeira edição, sem ninguém perceber.
      obsDaEntrada: entrada?.observacoes?.trim() || null,
    }
  })

  // Totais
  const { data: totais } = await supabase
    .from('contas_pagar')
    .select('status, valor')
    .eq('empresa_id', empresaId)

  const totalPendente = (totais ?? []).filter(c => c.status === 'pendente').reduce((s, c) => s + Number(c.valor), 0)
  const totalVencido = (totais ?? []).filter(c => c.status === 'vencido').reduce((s, c) => s + Number(c.valor), 0)
  const totalPago = (totais ?? []).filter(c => c.status === 'pago').reduce((s, c) => s + Number(c.valor), 0)

  // ── Base do resumo por fornecedor ───────────────────────────────────────
  //
  // TODAS as contas em aberto da empresa, sem o filtro de status da tela e
  // sem o limite de 200. É o ponto do recurso: ao escolher um fornecedor, o
  // operador quer saber quanto deve a ele — não quanto deve dentro do
  // recorte que está vendo. Um resumo calculado sobre a lista filtrada diria
  // "R$ 0 vencido" para quem está na aba "A vencer", que é pior que não ter
  // resumo.
  const { data: abertas } = await supabase
    .from('contas_pagar')
    .select('fornecedor_id, valor, vencimento, status')
    .eq('empresa_id', empresaId)
    .in('status', ['pendente', 'vencido'])

  return (
    <ContasPagarClient
      contas={contasComOrigem}
      contasAbertas={abertas ?? []}
      statusFiltro={status}
      qInicial={q}
      empresaId={empresaId}
      totalPendente={totalPendente}
      totalVencido={totalVencido}
      totalPago={totalPago}
      // Data de referência resolvida no servidor: o resumo do fornecedor
      // classifica vencido/mês corrente/mês seguinte, e o relógio do
      // navegador pode estar em outro fuso ou simplesmente errado.
      hojeIso={new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}
    />
  )
}
