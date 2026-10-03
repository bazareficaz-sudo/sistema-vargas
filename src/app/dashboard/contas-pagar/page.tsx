import { createClient } from '@/lib/supabase/server'
import ContasPagarClient from '@/components/ContasPagarClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { origemDaConta, pedidoDaConta, type DadosDaEntrada, type DadosDaNfe } from '@/lib/contas/origemDaConta'
import { intervaloDoPeriodo, periodoValido, rotuloIntervalo, statusDaUrl } from '@/lib/contas/periodo'
import { buscarTudo } from '@/lib/supabase/paginar'

export const dynamic = 'force-dynamic'

export default async function ContasPagarPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string; periodo?: string; de?: string; ate?: string }> }) {
  const { status = 'pendente', q = '', periodo, de = '', ate = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  // Data de referência resolvida no servidor, em Brasília: o relógio do
  // navegador pode estar em outro fuso ou simplesmente errado, e o do
  // servidor está em UTC.
  const hojeIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  // Atualiza status vencido automaticamente
  try { await supabase.rpc('atualizar_contas_vencidas') } catch {}

  let query = supabase
    .from('contas_pagar')
    .select('*, fornecedores(id, razao_social, nome_fantasia)')
    .eq('empresa_id', empresaId)
    .order('vencimento', { ascending: true })

  // `status` aceita vários separados por vírgula (ex: "pendente,vencido" =
  // tudo que está em aberto). "todos" ou vazio = sem recorte de status.
  const statusLista = statusDaUrl(status)
  if (statusLista) query = query.in('status', statusLista)
  if (q) query = query.ilike('descricao', `%${q}%`)

  // O recorte de período é no SERVIDOR, não na tela: a consulta é cortada em
  // 200 linhas, e filtrar depois deixaria "este mês" de fora o que ficou
  // além do corte.
  const periodoEscolhido = periodoValido(periodo)
  const intervalo = intervaloDoPeriodo(periodoEscolhido, hojeIso, de, ate)
  if (intervalo?.ini) query = query.gte('vencimento', intervalo.ini)
  if (intervalo?.fim) query = query.lte('vencimento', intervalo.fim)

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

  // ── Base dos cartões do topo ────────────────────────────────────────────
  //
  // Os cartões (A vencer / Vencido / Pago) seguem o recorte da tela, e não a
  // empresa inteira: período aqui no servidor; fornecedor e descrição na
  // tela (são filtros de lá). O STATUS fica de fora de propósito — cada
  // cartão é um status, e filtrar por ele zeraria os outros dois. Os chips
  // de status dizem o que a LISTA mostra; os cartões mostram o quadro todo
  // do recorte.
  //
  // Linhas leves, todas as do recorte e não as 200 da lista: somar a lista
  // cortada daria total errado. buscarTudo porque o PostgREST responde no
  // máximo 1.000 linhas, calado (ver src/lib/supabase/paginar.ts).
  const escopoCartoes = await buscarTudo<{ status: string; valor: number; fornecedor_id: string | null; descricao: string }>(
    (de, ate) => {
      let q2 = supabase.from('contas_pagar')
        .select('status, valor, fornecedor_id, descricao')
        .eq('empresa_id', empresaId)
        .order('id')
      if (intervalo?.ini) q2 = q2.gte('vencimento', intervalo.ini)
      if (intervalo?.fim) q2 = q2.lte('vencimento', intervalo.fim)
      return q2.range(de, ate)
    },
    { rotulo: 'contas-pagar cartões' },
  )

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
      statusFiltro={statusLista ? statusLista.join(',') : 'todos'}
      periodoFiltro={periodoEscolhido ?? ''}
      deFiltro={de}
      ateFiltro={ate}
      intervaloRotulo={rotuloIntervalo(intervalo)}
      qInicial={q}
      empresaId={empresaId}
      escopoCartoes={escopoCartoes}
      // O resumo do fornecedor classifica vencido/mês corrente/mês seguinte
      // a partir desta data.
      hojeIso={hojeIso}
    />
  )
}
