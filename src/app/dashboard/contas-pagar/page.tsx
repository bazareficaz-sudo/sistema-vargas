import { createClient } from '@/lib/supabase/server'
import ContasPagarClient, { type ContaPagar } from '@/components/ContasPagarClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { origemDaConta, pedidoDaConta, type DadosDaEntrada, type DadosDaNfe } from '@/lib/contas/origemDaConta'
import { somarMeses } from '@/lib/contas/agendaPagar'

export const dynamic = 'force-dynamic'

// Links antigos (?status=pendente) continuam caindo no lugar certo.
const STATUS_ANTIGO: Record<string, string> = { pendente: 'a_vencer', vencido: 'vencido', pago: 'pago', todos: 'todos' }

/** `.in()` vai na URL; centenas de UUIDs de uma vez estouram o limite dela. */
async function emLotes<T>(ids: string[], buscar: (lote: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 150) out.push(...((await buscar(ids.slice(i, i + 150))).data ?? []))
  return out
}

export default async function ContasPagarPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  // Atualiza status vencido automaticamente
  try { await supabase.rpc('atualizar_contas_vencidas') } catch {}

  // Data de referência resolvida no servidor e no fuso de Brasília: vencido,
  // semana e mês dependem dela, e o relógio do navegador pode estar errado.
  const hojeIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  // ── O que vai para a tela ───────────────────────────────────────────────
  //
  // TODA conta em aberto, de qualquer data — sem isso, o total vencido e a
  // agenda dos próximos meses ficariam incompletos. Pagas e canceladas, só
  // as dos últimos 12 meses (pelo vencimento ou pelo pagamento): é o que dá
  // o "quanto teve de boleto neste mês" sem carregar a história inteira.
  //
  // Antes a tela pedia um status por vez, cortado em 200 linhas — por isso
  // não dava para ver vencidos e a vencer juntos, nem somar a semana.
  const desde = `${somarMeses(hojeIso.slice(0, 7), -12)}-01`
  const colunas = '*, fornecedores(id, razao_social, nome_fantasia)'
  type Linha = { entrada_id: string | null; origem: string | null; origem_id: string | null } & Record<string, unknown>
  const lista: Linha[] = []
  for (let de = 0; ; de += 1000) {
    const { data } = await supabase
      .from('contas_pagar')
      .select(colunas)
      .eq('empresa_id', empresaId)
      .or(`status.in.(pendente,vencido),vencimento.gte.${desde},data_pagamento.gte.${desde}`)
      .order('vencimento', { ascending: true })
      .order('id', { ascending: true })
      .range(de, de + 999)
    lista.push(...((data ?? []) as Linha[]))
    if (!data || data.length < 1000) break
  }

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

  const [entradas, nfes, { data: tipos }] = await Promise.all([
    emLotes<DadosDaEntrada>(entradaIds, lote => supabase.from('entradas')
      .select('id, numero_nf, numero_entrada, observacoes, pedido_compra_id')
      .eq('empresa_id', empresaId).in('id', lote)),
    emLotes<DadosDaNfe>(nfeIds, lote => supabase.from('nfe_entradas')
      .select('id, numero, serie')
      .eq('empresa_id', empresaId).in('id', lote)),
    supabase.from('tipos_despesa').select('id, nome, cor').eq('empresa_id', empresaId).order('nome'),
  ])

  const porEntrada = new Map(entradas.map(e => [e.id, e]))
  const porNfe = new Map(nfes.map(n => [n.id, n]))

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

  return (
    <ContasPagarClient
      contas={contasComOrigem as unknown as ContaPagar[]}
      tipos={tipos ?? []}
      desde={desde}
      filtroInicial={{
        situacao: STATUS_ANTIGO[sp.status ?? ''] ?? sp.situacao ?? 'aberto',
        periodo: sp.periodo ?? 'todos',
        de: sp.de ?? '', ate: sp.ate ?? '',
        q: sp.q ?? '',
      }}
      empresaId={empresaId}
      hojeIso={hojeIso}
    />
  )
}
