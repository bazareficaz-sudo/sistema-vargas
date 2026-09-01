import { createClient } from '@/lib/supabase/server'
import { loadPlanData } from '@/lib/plans/access'
import { permissoesEfetivas, buscarExcecoes, type Papel } from '@/lib/auth/permissoes'
import FiltroMes from '@/components/dashboard/FiltroMes'
import Link from 'next/link'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { inicioDoDia, inicioDoMes, inicioDeDiasAtras, diaISO } from '@/lib/datas'
import DashboardCashFlowChart, { type CashFlowPoint } from '@/components/dashboard/DashboardCashFlowChart'
import KpiSparkline from '@/components/dashboard/KpiSparkline'
import SalesPulseChart, { type SalesPulsePoint } from '@/components/dashboard/SalesPulseChart'
import AskVargas from '@/components/dashboard/AskVargas'
import { buscarTudo } from '@/lib/supabase/paginar'

export const dynamic = 'force-dynamic'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ymd = (d: Date) => d.toISOString().slice(0, 10)

type CompraRow = { valor_total: number | null; fornecedor_id: string | null; data_emissao: string | null; data_entrada?: string | null; nome_fornecedor?: string | null }
type ResumoVendaRow = { faturamento: number | null; quantidade: number | null }
type VendaDiaRow = { dia: string; faturamento: number | null; quantidade: number | null }
type ContaReceberRow = { valor_aberto: number | null; status: string; data_vencimento: string | null }
type ContaPagarRow = { valor: number | null; status: string; vencimento: string | null }
type VendaRow = { id: string; numero: number | string | null; total: number | null; status: string; created_at: string; cliente_id: string | null; canal: string | null; desconto: number | null; clientes: { nome: string }[] }
type VendaHistoricaRow = { total: number | null; created_at: string }
type CanalRow = { id: string; nome: string; plataforma: string }
type PedidoMarketplaceRow = { valor_total: number | null; status: string; canal_id: string | null }
type FornecedorRow = { id: string; razao_social: string; nome_fantasia: string | null }
type ProdutoVendidoRow = { produto_id: string; quantidade: number | null; faturamento: number | null }
type VendaVendedorRow = { total: number | null; status: string; vendedor_nome: string | null }

type InsightTone = 'critical' | 'warning' | 'opportunity'
type Insight = {
  tone: InsightTone
  eyebrow: string
  title: string
  value: string
  description: string
  evidence: string
  href: string
  action: string
}
type PulseSignal = { tone: 'negative' | 'warning' | 'positive' | 'neutral'; title: string; detail: string }

export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<{ mes?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const profile = await perfilDaSessao(supabase, user!.id, 'empresa_id, nome')

  const empresaId = profile?.empresa_id ?? ''
  const plan = await loadPlanData(empresaId, user!.id)

  // Painel financeiro da Visao Geral respeita a permissao do usuario: sem
  // 'ver_dashboard_financeiro' o funcionario entra na tela e nao ve venda do
  // dia, faturamento do mes nem contas. Vale por usuario, configurado em
  // Usuarios -> Permissoes.
  const { data: perfilPermissao } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  const permissoesUsuario = permissoesEfetivas(
    (perfilPermissao?.role ?? null) as Papel | null,
    await buscarExcecoes(supabase, user!.id),
  )
  const podeVerFinanceiro = permissoesUsuario.includes('ver_dashboard_financeiro')
  const tem = (modulo: string) => plan.modulos.includes('*') || plan.modulos.includes(modulo)
  const temVendas = tem('vendas') || tem('pdv')
  const temCompras = tem('entradas') || tem('entradas_xml')

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  // Recortes de tempo no fuso da loja, não no do servidor. A Vercel roda em
  // UTC: `setHours(0,0,0,0)` aqui é 21h de ontem em São Paulo, e "vendas de
  // hoje" vinha começando três horas cedo demais.
  const inicioHoje = inicioDoDia().toISOString()
  const inicioMes = inicioDoMes().toISOString()
  const todayStr = diaISO()
  const inicioHojeDate = new Date(inicioHoje)
  const intervalosMesmosDias = Array.from({ length: 8 }, (_, indice) => {
    const inicio = new Date(inicioHojeDate.getTime() - (indice + 1) * 7 * 24 * 60 * 60 * 1000)
    return { inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + 24 * 60 * 60 * 1000).toISOString() }
  })

  // ── Mês selecionado pro widget de compras ──────────────────────────────
  const { mes: mesParam } = await searchParams
  const mesValido = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  const [anoSel, mesSelNum] = mesValido.split('-').map(Number)
  const inicioMesSel = new Date(anoSel, mesSelNum - 1, 1)
  const inicioProxMesSel = new Date(anoSel, mesSelNum, 1)
  const inicioMesAntSel = new Date(anoSel, mesSelNum - 2, 1)
  const inicioMesSelStr = ymd(inicioMesSel)
  const inicioProxMesSelStr = ymd(inicioProxMesSel)
  const inicioMesAntSelStr = ymd(inicioMesAntSel)

  if (tem('contas_pagar')) {
    try { await supabase.rpc('atualizar_contas_vencidas') } catch {}
  }

  const [
    vendasHojeRes, vendasMesRes, vendas14DiasRes, vendasMesmosDiasRes,
    produtosRes, clientesRes, fornecedoresCountRes,
    crRes, cpRes,
    ultimasVendasRes,
    canaisRes, pedidosMarketplaceHojeRes,
    entradasCompraRes, nfeEntradasCompraRes,
    fornecedoresListRes,
    produtosVendidosMesRes,
    vendasVendedoresMes,
  ] = await Promise.all([
    // Soma no banco, não aqui. Buscar as linhas e reduzi-las em JavaScript
    // parecia inocente e não era: o PostgREST devolve no máximo 1.000 linhas,
    // então o "faturamento do mês" virava o faturamento das 1.000 primeiras
    // vendas do mês. Em agosto/26 isso escondeu R$ 18.397,59 de R$ 45.012,53,
    // sem erro nenhum na tela. `vendas_resumo` está em
    // supabase-relatorios-agregados.sql.
    temVendas ? supabase.rpc('vendas_resumo', { p_empresa: empresaId, p_inicio: inicioHoje }) : Promise.resolve({ data: [] as ResumoVendaRow[] }),
    temVendas ? supabase.rpc('vendas_resumo', { p_empresa: empresaId, p_inicio: inicioMes }) : Promise.resolve({ data: [] as ResumoVendaRow[] }),
    temVendas ? supabase.rpc('vendas_por_dia', { p_empresa: empresaId, p_inicio: inicioDeDiasAtras(13, hoje).toISOString() }) : Promise.resolve({ data: [] as VendaDiaRow[] }),
    temVendas ? Promise.all(intervalosMesmosDias.map(intervalo => supabase.from('vendas').select('total, created_at').eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', intervalo.inicio).lt('created_at', intervalo.fim).limit(1000))) : Promise.resolve([] as { data: VendaHistoricaRow[] | null }[]),
    tem('produtos') ? supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('ativo', true) : Promise.resolve({ count: null }),
    // `mesclado_em` fora da conta: cadastro unificado noutro nao e um cliente
    // a mais, e conta-lo inflava o indicador em silencio.
    tem('clientes') ? supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).is('mesclado_em', null) : Promise.resolve({ count: null }),
    tem('fornecedores') ? supabase.from('fornecedores').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId) : Promise.resolve({ count: null }),
    tem('contas_receber') ? supabase.from('contas_receber').select('valor_aberto, status, data_vencimento').eq('empresa_id', empresaId).not('status', 'in', '(cancelado,recebido,renegociado)') : Promise.resolve({ data: [] as ContaReceberRow[] }),
    tem('contas_pagar') ? supabase.from('contas_pagar').select('valor, status, vencimento').eq('empresa_id', empresaId).neq('status', 'cancelado') : Promise.resolve({ data: [] as ContaPagarRow[] }),
    temVendas ? supabase.from('vendas').select('id, numero, total, status, created_at, cliente_id, canal, desconto, clientes(nome)').eq('empresa_id', empresaId).gte('created_at', inicioHoje).order('created_at', { ascending: false }).limit(500) : Promise.resolve({ data: [] as VendaRow[] }),
    tem('marketplace') ? supabase.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', empresaId).eq('ativo', true) : Promise.resolve({ data: [] as CanalRow[] }),
    tem('marketplace') ? supabase.from('marketplace_pedidos').select('valor_total, status, canal_id').eq('empresa_id', empresaId).gte('data_pedido', inicioHoje).not('status', 'in', '(cancelado,devolvido)') : Promise.resolve({ data: [] as PedidoMarketplaceRow[] }),
    // Entrada manual não tem nota, então quase nunca tem data de emissão
    // (4 de 31 em produção) — a data que sempre existe é a da entrada da
    // mercadoria. Filtrar só por data_emissao descartava as manuais inteiras
    // e o card de compras mostrava apenas o que veio de XML.
    (temCompras && tem('entradas')) ? supabase.from('entradas').select('valor_total, fornecedor_id, data_emissao, data_entrada').eq('empresa_id', empresaId).neq('status', 'cancelada').or(`and(data_emissao.gte.${inicioMesAntSelStr},data_emissao.lt.${inicioProxMesSelStr}),and(data_emissao.is.null,data_entrada.gte.${inicioMesAntSelStr},data_entrada.lt.${inicioProxMesSelStr})`) : Promise.resolve({ data: [] as CompraRow[] }),
    (temCompras && tem('entradas_xml')) ? supabase.from('nfe_entradas').select('valor_total, fornecedor_id, nome_fornecedor, data_emissao').eq('empresa_id', empresaId).neq('status', 'cancelada').gte('data_emissao', inicioMesAntSelStr).lt('data_emissao', inicioProxMesSelStr) : Promise.resolve({ data: [] as CompraRow[] }),
    (temCompras && tem('fornecedores')) ? supabase.from('fornecedores').select('id, razao_social, nome_fantasia').eq('empresa_id', empresaId) : Promise.resolve({ data: [] as FornecedorRow[] }),
    temVendas ? supabase.rpc('produtos_vendidos', {
      p_empresa: empresaId,
      p_inicio: inicioMes,
      p_fim: new Date(new Date(inicioHoje).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    }) : Promise.resolve({ data: [] as ProdutoVendidoRow[] }),
    temVendas ? buscarTudo<VendaVendedorRow>(
      (de, ate) => supabase.from('vendas')
        .select('total, status, vendedor_nome')
        .eq('empresa_id', empresaId)
        .gte('created_at', inicioMes)
        .lt('created_at', new Date(new Date(inicioHoje).getTime() + 24 * 60 * 60 * 1000).toISOString())
        .order('created_at').order('id').range(de, ate),
      { rotulo: 'vendas (ranking de vendedores no dashboard)' },
    ) : Promise.resolve([] as VendaVendedorRow[]),
  ])

  // `vendas_resumo` devolve uma linha só: faturamento, quantidade, desconto.
  const resumoHoje = (vendasHojeRes.data ?? [])[0] ?? { faturamento: 0, quantidade: 0 }
  const resumoMes = (vendasMesRes.data ?? [])[0] ?? { faturamento: 0, quantidade: 0 }
  const totalHoje = Number(resumoHoje.faturamento ?? 0)
  const qtdHoje = Number(resumoHoje.quantidade ?? 0)
  const totalMes = Number(resumoMes.faturamento ?? 0)

  const produtosVendidosMes = (produtosVendidosMesRes.data ?? []) as ProdutoVendidoRow[]
  const liderQuantidade = [...produtosVendidosMes].sort((a, b) => Number(b.quantidade ?? 0) - Number(a.quantidade ?? 0))[0]
  const liderFaturamento = [...produtosVendidosMes].sort((a, b) => Number(b.faturamento ?? 0) - Number(a.faturamento ?? 0))[0]
  const idsProdutosLideres = [...new Set([liderQuantidade?.produto_id, liderFaturamento?.produto_id].filter((id): id is string => Boolean(id)))]
  const { data: nomesProdutosLideres } = idsProdutosLideres.length > 0
    ? await supabase.from('produtos').select('id, nome').eq('empresa_id', empresaId).in('id', idsProdutosLideres)
    : { data: [] as { id: string; nome: string }[] }
  const nomeProduto = new Map((nomesProdutosLideres ?? []).map(produto => [produto.id, produto.nome]))
  const desempenhoVendedores = new Map<string, { faturamento: number; vendas: number }>()
  for (const venda of vendasVendedoresMes) {
    if (venda.status !== 'concluida') continue
    const nome = venda.vendedor_nome?.trim()
    if (!nome) continue
    const atual = desempenhoVendedores.get(nome) ?? { faturamento: 0, vendas: 0 }
    atual.faturamento += Number(venda.total ?? 0)
    atual.vendas++
    desempenhoVendedores.set(nome, atual)
  }
  const vendedorCampeao = [...desempenhoVendedores.entries()]
    .map(([nome, desempenho]) => ({ nome, ...desempenho }))
    .sort((a, b) => b.faturamento - a.faturamento)[0]

  const canaisConectados = canaisRes.data ?? []
  const pedidosMarketplaceHoje = pedidosMarketplaceHojeRes.data ?? []
  const totalMarketplaceHoje = pedidosMarketplaceHoje.reduce((s, p) => s + Number(p.valor_total ?? 0), 0)
  const qtdMarketplaceHoje = pedidosMarketplaceHoje.length

  // status real: aberto | parcial | recebido | vencido | cancelado | renegociado
  // (não "pendente" — e valor_aberto já vem calculado do banco, sem valor_pago)
  const crPendente = (crRes.data ?? []).filter(c => ['aberto', 'parcial'].includes(c.status)).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
  const crVencido = (crRes.data ?? []).filter(c => c.status === 'vencido').reduce((s, c) => s + (c.valor_aberto ?? 0), 0)

  // Sem valor_pago — a coluna não existe em contas_pagar. "Vencida" é
  // calculado na hora (não só pelo status, que só é promovido pela RPC
  // acima) pra nunca ficar desatualizado mesmo se a RPC falhar.
  const cp = cpRes.data ?? []
  const cpVencidas = cp.filter(c => c.status === 'vencido' || (c.status === 'pendente' && c.vencimento < todayStr)).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpHoje = cp.filter(c => c.status === 'pendente' && c.vencimento === todayStr).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpAVencer = cp.filter(c => c.status === 'pendente' && c.vencimento > todayStr).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpTotal = cpVencidas + cpHoje + cpAVencer

  // Séries compactas dos cards. Vendas olham 14 dias para trás; receber e
  // pagar mostram o acúmulo de títulos pelos próximos 14 dias, começando pelo
  // que já está vencido. Assim o traço sempre comunica dados reais.
  const vendasPorDia14 = new Map<string, number>(
    (vendas14DiasRes.data ?? []).map((linha: VendaDiaRow) => [
      String(linha.dia).slice(0, 10),
      Number(linha.faturamento ?? 0),
    ] as [string, number]),
  )
  const chavesPassadas14 = Array.from({ length: 14 }, (_, indice) => {
    const data = new Date(`${todayStr}T12:00:00`)
    data.setDate(data.getDate() - (13 - indice))
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
  })
  const serieVendasHoje = chavesPassadas14.map(chave => vendasPorDia14.get(chave) ?? 0)
  const serieFaturamento = serieVendasHoje.map((_, indice) => serieVendasHoje.slice(0, indice + 1).reduce((total, valor) => total + valor, 0))

  const chavesFuturas14 = Array.from({ length: 14 }, (_, indice) => {
    const data = new Date(`${todayStr}T12:00:00`)
    data.setDate(data.getDate() + indice)
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
  })
  const serieReceber = chavesFuturas14.map((_, indice) => crVencido + (crRes.data ?? [])
    .filter(conta => ['aberto', 'parcial'].includes(conta.status) && conta.data_vencimento && String(conta.data_vencimento).slice(0, 10) <= chavesFuturas14[indice])
    .reduce((total, conta) => total + Number(conta.valor_aberto ?? 0), 0))
  const seriePagar = chavesFuturas14.map((_, indice) => cpVencidas + cp
    .filter(conta => conta.status === 'pendente' && conta.vencimento && conta.vencimento <= chavesFuturas14[indice])
    .reduce((total, conta) => total + Number(conta.valor ?? 0), 0))

  const vendasConcluidasHoje = (ultimasVendasRes.data ?? []).filter(venda => venda.status === 'concluida')
  const horaDaVendaSP = (data: string) => new Date(new Date(data).getTime() - 3 * 60 * 60 * 1000).getUTCHours()
  const horaAtualSP = new Date(hoje.getTime() - 3 * 60 * 60 * 1000).getUTCHours()
  const horaFinalGrafico = Math.max(20, Math.min(23, horaAtualSP))
  const horasPulso = Array.from({ length: horaFinalGrafico - 7 + 1 }, (_, indice) => indice + 7)
  const historicosPorSemana = vendasMesmosDiasRes.map(resultado => resultado.data ?? [])
  const acumuladoAteHora = (vendas: VendaHistoricaRow[] | VendaRow[], hora: number) => vendas
    .filter(venda => horaDaVendaSP(venda.created_at) <= hora)
    .reduce((total, venda) => total + Number(venda.total ?? 0), 0)
  const mediaHistoricaAteHora = (hora: number) => historicosPorSemana.length === 0 ? 0 : historicosPorSemana
    .reduce((total, semana) => total + acumuladoAteHora(semana, hora), 0) / historicosPorSemana.length
  const pulsoVendas: SalesPulsePoint[] = horasPulso.map(hora => ({
    hora: `${String(hora).padStart(2, '0')}h`,
    hoje: hora <= horaAtualSP ? acumuladoAteHora(vendasConcluidasHoje, hora) : null,
    media: mediaHistoricaAteHora(hora),
  }))
  const mediaAteAgora = mediaHistoricaAteHora(horaAtualSP)
  const mediaDiaCompleto = mediaHistoricaAteHora(23)
  const projecaoFechamento = mediaAteAgora > 0 ? totalHoje * (mediaDiaCompleto / mediaAteAgora) : totalHoje
  const ticketMedioHoje = qtdHoje > 0 ? totalHoje / qtdHoje : 0
  const qtdHistoricaAteAgora = historicosPorSemana.length === 0 ? 0 : historicosPorSemana
    .reduce((total, semana) => total + semana.filter(venda => horaDaVendaSP(venda.created_at) <= horaAtualSP).length, 0) / historicosPorSemana.length
  const ticketHistoricoAteAgora = qtdHistoricaAteAgora > 0 ? mediaAteAgora / qtdHistoricaAteAgora : 0
  const variacaoRitmo = mediaAteAgora > 0 ? ((totalHoje - mediaAteAgora) / mediaAteAgora) * 100 : null
  const variacaoTicket = ticketHistoricoAteAgora > 0 ? ((ticketMedioHoje - ticketHistoricoAteAgora) / ticketHistoricoAteAgora) * 100 : null
  const vendasSemCliente = vendasConcluidasHoje.filter(venda => !venda.cliente_id).length
  const percentualSemCliente = vendasConcluidasHoje.length > 0 ? (vendasSemCliente / vendasConcluidasHoje.length) * 100 : 0
  const participacaoMarketplace = totalHoje > 0 ? (totalMarketplaceHoje / totalHoje) * 100 : 0
  const sinaisPulso: PulseSignal[] = [
    {
      tone: percentualSemCliente >= 70 ? 'warning' : 'neutral',
      title: `${percentualSemCliente.toFixed(0)}% das vendas sem cliente`,
      detail: `${vendasSemCliente} de ${vendasConcluidasHoje.length} transações não alimentam recorrência e pós-venda.`,
    },
    variacaoRitmo === null ? {
      tone: 'neutral', title: 'Histórico ainda insuficiente', detail: 'O ritmo será comparado quando houver semanas equivalentes.',
    } : {
      tone: variacaoRitmo >= 0 ? 'positive' : 'negative',
      title: `Ritmo ${Math.abs(variacaoRitmo).toFixed(0)}% ${variacaoRitmo >= 0 ? 'acima' : 'abaixo'} do normal`,
      detail: `Comparação com o mesmo horário das últimas ${historicosPorSemana.length} semanas.`,
    },
    variacaoTicket === null ? {
      tone: 'neutral', title: 'Ticket sem referência', detail: `Ticket médio de hoje: ${brl(ticketMedioHoje)}.`,
    } : {
      tone: variacaoTicket >= 0 ? 'positive' : 'warning',
      title: `Ticket médio ${Math.abs(variacaoTicket).toFixed(0)}% ${variacaoTicket >= 0 ? 'maior' : 'menor'}`,
      detail: `${brl(ticketMedioHoje)} por venda no ritmo atual.`,
    },
    {
      tone: 'neutral', title: `Marketplace representa ${participacaoMarketplace.toFixed(0)}%`,
      detail: `${brl(totalMarketplaceHoje)} das vendas registradas hoje.`,
    },
  ]

  // ── Compras do mês (entradas manuais + XML combinadas) ─────────────────
  const comprasRows: CompraRow[] = [...(entradasCompraRes.data ?? []), ...(nfeEntradasCompraRes.data ?? [])]
  // A data da nota quando existe; senão, a data em que a mercadoria entrou.
  // Fatia em 10 porque data_entrada pode vir com hora e a comparação é com
  // 'AAAA-MM-DD'.
  const dataDaCompra = (r: CompraRow) => r.data_emissao ?? (r.data_entrada ? String(r.data_entrada).slice(0, 10) : null)
  const comprasMesAtual = comprasRows.filter(r => { const d = dataDaCompra(r); return d && d >= inicioMesSelStr && d < inicioProxMesSelStr })
  const comprasMesAnterior = comprasRows.filter(r => { const d = dataDaCompra(r); return d && d < inicioMesSelStr })
  const totalComprasMes = comprasMesAtual.reduce((s, r) => s + Number(r.valor_total ?? 0), 0)
  const totalComprasMesAnterior = comprasMesAnterior.reduce((s, r) => s + Number(r.valor_total ?? 0), 0)
  const variacaoCompras = totalComprasMesAnterior > 0 ? ((totalComprasMes - totalComprasMesAnterior) / totalComprasMesAnterior) * 100 : null

  const fornecedorNomePorId = new Map((fornecedoresListRes.data ?? []).map((f: FornecedorRow) => [f.id, f.nome_fantasia ?? f.razao_social]))
  const comprasPorFornecedor = new Map<string, { nome: string; total: number }>()
  for (const r of comprasMesAtual) {
    const chave = r.fornecedor_id ?? r.nome_fornecedor ?? 'sem-fornecedor'
    const nome = (r.fornecedor_id && fornecedorNomePorId.get(r.fornecedor_id)) || r.nome_fornecedor || 'Sem fornecedor identificado'
    const atual = comprasPorFornecedor.get(chave) ?? { nome, total: 0 }
    atual.total += Number(r.valor_total ?? 0)
    comprasPorFornecedor.set(chave, atual)
  }
  const rankingFornecedores = [...comprasPorFornecedor.values()].sort((a, b) => b.total - a.total).slice(0, 5)

  // Projeção operacional: considera somente títulos já registrados. Não é
  // apresentada como "saldo de caixa", porque ainda não inclui conta bancária,
  // vendas futuras ou despesas que ainda não foram lançadas.
  const recebimentosPorDia = new Map<string, number>()
  for (const conta of crRes.data ?? []) {
    if (!['aberto', 'parcial'].includes(conta.status) || !conta.data_vencimento) continue
    const data = String(conta.data_vencimento).slice(0, 10)
    recebimentosPorDia.set(data, (recebimentosPorDia.get(data) ?? 0) + Number(conta.valor_aberto ?? 0))
  }
  const pagamentosPorDia = new Map<string, number>()
  for (const conta of cp) {
    if (conta.status !== 'pendente' || !conta.vencimento) continue
    const data = String(conta.vencimento).slice(0, 10)
    pagamentosPorDia.set(data, (pagamentosPorDia.get(data) ?? 0) + Number(conta.valor ?? 0))
  }

  const movimentos30Dias = Array.from({ length: 31 }, (_, indice) => {
    const data = new Date(`${todayStr}T12:00:00`)
    data.setDate(data.getDate() + indice)
    const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
    const entradas = recebimentosPorDia.get(chave) ?? 0
    const saidas = pagamentosPorDia.get(chave) ?? 0
    return {
      data: data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }),
      label: data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      entradas,
      saidas,
    }
  })
  const fluxo30Dias: CashFlowPoint[] = movimentos30Dias.map((movimento, indice) => ({
    ...movimento,
    saldo: movimentos30Dias
      .slice(0, indice + 1)
      .reduce((total, ponto) => total + ponto.entradas - ponto.saidas, 0),
  }))
  const saldoPrevisto30 = fluxo30Dias.at(-1)?.saldo ?? 0
  const menorSaldo30 = Math.min(0, ...fluxo30Dias.map(ponto => ponto.saldo))
  const totalReceber = crPendente + crVencido
  const percentualContasVencidas = cpTotal > 0 ? (cpVencidas / cpTotal) * 100 : 0

  const insights: Insight[] = []
  if (tem('contas_pagar') && cpVencidas > 0) {
    insights.push({
      tone: 'critical', eyebrow: 'Crítico', title: 'Contas vencidas exigem ação', value: brl(cpVencidas),
      description: `${percentualContasVencidas.toFixed(1).replace('.', ',')}% de tudo que está em aberto já passou do vencimento.`,
      evidence: 'Contas a pagar · atualizado agora', href: '/dashboard/contas-pagar', action: 'Revisar contas',
    })
  }
  if (tem('contas_pagar') && tem('contas_receber') && saldoPrevisto30 < 0) {
    insights.push({
      tone: 'warning', eyebrow: 'Atenção', title: 'Déficit operacional previsto', value: brl(Math.abs(saldoPrevisto30)),
      description: 'Os pagamentos registrados para 30 dias superam os recebimentos previstos no período.',
      evidence: 'Títulos em aberto · próximos 30 dias', href: '/dashboard/relatorios/financeiro', action: 'Ver projeção',
    })
  }
  if (temCompras && variacaoCompras !== null && Math.abs(variacaoCompras) >= 10) {
    const aumentou = variacaoCompras > 0
    insights.push({
      tone: aumentou ? 'warning' : 'opportunity', eyebrow: aumentou ? 'Atenção' : 'Oportunidade',
      title: aumentou ? 'Compras cresceram neste mês' : 'Compras recuaram neste mês',
      value: `${Math.abs(variacaoCompras).toFixed(0)}%`,
      description: aumentou ? 'O volume comprado merece comparação com vendas e giro de estoque.' : 'Há menor comprometimento de capital em compras frente ao mês anterior.',
      evidence: `${comprasMesAtual.length} entradas analisadas`, href: '/dashboard/entradas', action: 'Analisar compras',
    })
  }
  if (insights.length === 0 && temVendas) {
    insights.push({
      tone: 'opportunity', eyebrow: 'Operação estável', title: 'Nenhuma urgência detectada agora', value: brl(totalMes),
      description: 'Os indicadores disponíveis não mostram desvios críticos. Continue acompanhando o ritmo de vendas.',
      evidence: 'Vendas e financeiro · atualizado agora', href: '/dashboard/relatorios/vendas', action: 'Ver desempenho',
    })
  }

  const briefingCritico = cpVencidas > 0 || saldoPrevisto30 < 0
  const briefingTitulo = briefingCritico
    ? 'A operação está vendendo, mas o financeiro exige atenção.'
    : 'A operação está estável e sem alertas financeiros críticos.'
  const briefingTexto = cpVencidas > 0
    ? `${brl(cpVencidas)} em contas vencidas precisam ser priorizados. O sistema encontrou ${insights.length} ${insights.length === 1 ? 'situação relevante' : 'situações relevantes'} hoje.`
    : `O faturamento do mês está em ${brl(totalMes)}. Continue acompanhando recebimentos, pagamentos e compras.`

  const diaSemana = hoje.toLocaleDateString('pt-BR', { weekday: 'long' })
  const dataFmt = hoje.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

  const ATALHOS = [
    { href: '/pdv', icon: '🖥', label: 'PDV', color: 'bg-blue-50 text-blue-600 hover:bg-blue-100', mod: 'pdv' },
    { href: '/dashboard/contas-receber', icon: '💰', label: 'A Receber', color: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100', mod: 'contas_receber' },
    { href: '/dashboard/contas-pagar', icon: '💳', label: 'A Pagar', color: 'bg-rose-50 text-rose-600 hover:bg-rose-100', mod: 'contas_pagar' },
    { href: '/dashboard/produtos', icon: '📦', label: 'Produtos', color: 'bg-violet-50 text-violet-600 hover:bg-violet-100', mod: 'produtos' },
    { href: '/dashboard/clientes', icon: '👥', label: 'Clientes', color: 'bg-amber-50 text-amber-600 hover:bg-amber-100', mod: 'clientes' },
    { href: '/dashboard/entradas/nova', icon: '📥', label: 'Entrada', color: 'bg-teal-50 text-teal-600 hover:bg-teal-100', mod: 'entradas' },
    { href: '/dashboard/entradas-xml', icon: '📄', label: 'XML / NF-e', color: 'bg-sky-50 text-sky-600 hover:bg-sky-100', mod: 'entradas_xml' },
    { href: '/dashboard/fornecedores', icon: '🏭', label: 'Fornecedores', color: 'bg-orange-50 text-orange-600 hover:bg-orange-100', mod: 'fornecedores' },
  ].filter(a => tem(a.mod))

  const nadaAtivo = !temVendas && !temCompras && !tem('contas_pagar') && !tem('contas_receber') && !tem('marketplace')

  return (
    <div className="space-y-7 pb-10">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-slate-400 text-sm capitalize">{diaSemana}, {dataFmt}</p>
          <h1 className="text-slate-950 text-3xl font-bold mt-1 tracking-tight">Bom dia, {profile?.nome?.split(' ')[0] ?? 'gestor'}</h1>
          <p className="text-slate-500 text-sm mt-1">Aqui está o que precisa da sua atenção hoje.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-3 py-1.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Sistema online
          </span>
          {tem('pdv') && (
            <Link href="/pdv" className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-full font-medium transition-colors">
              🖥 Abrir PDV
            </Link>
          )}
        </div>
      </div>

      {nadaAtivo && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center text-slate-400">
          Nenhum módulo com dados pra mostrar aqui ainda.
        </div>
      )}

      {!nadaAtivo && podeVerFinanceiro && (
        <section className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-r from-white via-indigo-50/60 to-violet-50 px-5 py-5 shadow-sm sm:px-7 sm:py-6">
          <div className="absolute -right-12 -top-20 h-48 w-48 rounded-full bg-indigo-200/30 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200" aria-hidden="true">
                <SparklesIcon />
              </div>
              <div>
                <p className="text-base font-semibold text-indigo-950 sm:text-lg">{briefingTitulo}</p>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{briefingTexto}</p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-indigo-100 bg-white/80 px-3 py-1.5 text-xs font-medium text-indigo-700 sm:self-center">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              Análise atualizada agora
            </span>
          </div>
        </section>
      )}

      {/* ── KPIs principais ────────────────────────────────────────────────── */}
      {podeVerFinanceiro && (temVendas || tem('contas_receber') || tem('contas_pagar')) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {temVendas && (
            <KpiCard
              label="Vendas hoje" value={brl(totalHoje)} sub={`${qtdHoje} transaç${qtdHoje === 1 ? 'ão' : 'ões'}`}
              icon="🛒" accent="#3b82f6" bg="from-blue-50 to-indigo-50" href="/dashboard/vendas"
              sparkline={serieVendasHoje} sparklineLabel="Faturamento diário nos últimos 14 dias"
            />
          )}
          {temVendas && (
            <KpiCard
              label="Faturamento do mês" value={brl(totalMes)} sub="vendas concluídas"
              icon="📈" accent="#10b981" bg="from-emerald-50 to-teal-50" href="/dashboard/relatorios/vendas"
              sparkline={serieFaturamento} sparklineLabel="Faturamento acumulado nos últimos 14 dias"
            />
          )}
          {tem('contas_receber') && (
            <KpiCard
              label="A receber" value={brl(crPendente + crVencido)} sub={crVencido > 0 ? `${brl(crVencido)} vencido` : 'em dia'}
              icon="💰" accent={crVencido > 0 ? '#f59e0b' : '#10b981'} bg={crVencido > 0 ? 'from-amber-50 to-orange-50' : 'from-emerald-50 to-teal-50'}
              href="/dashboard/contas-receber" alert={crVencido > 0}
              sparkline={serieReceber} sparklineLabel="Recebimentos acumulados por vencimento nos próximos 14 dias"
            />
          )}
          {tem('contas_pagar') && (
            <KpiCard
              label="A pagar" value={brl(cpTotal)} sub={cpVencidas > 0 ? `${brl(cpVencidas)} vencido` : cpHoje > 0 ? `${brl(cpHoje)} vencem hoje` : 'em dia'}
              icon="💳" accent={cpVencidas > 0 ? '#ef4444' : cpHoje > 0 ? '#f59e0b' : '#64748b'} bg={cpVencidas > 0 ? 'from-red-50 to-rose-50' : 'from-slate-50 to-gray-50'}
              href="/dashboard/contas-pagar" alert={cpVencidas > 0}
              sparkline={seriePagar} sparklineLabel="Pagamentos acumulados por vencimento nos próximos 14 dias"
            />
          )}
        </div>
      )}

      {podeVerFinanceiro && insights.length > 0 && (
        <section aria-labelledby="prioridades-dashboard">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 id="prioridades-dashboard" className="text-lg font-semibold text-slate-950">Prioridades de hoje</h2>
              <p className="mt-0.5 text-xs text-slate-500">Ordenadas por impacto nos dados já registrados.</p>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {insights.slice(0, 3).map((insight) => <InsightCard key={`${insight.tone}-${insight.title}`} insight={insight} />)}
          </div>
        </section>
      )}

      {podeVerFinanceiro && tem('contas_pagar') && tem('contas_receber') && (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,.8fr)]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-950">Saldo operacional previsto</h2>
                  <span className="group relative text-slate-400" title="Recebimentos menos pagamentos já registrados. Não representa saldo bancário.">
                    <InfoIcon />
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Recebimentos menos pagamentos registrados nos próximos 30 dias.</p>
              </div>
              <span className="self-start rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">30 dias</span>
            </div>
            <DashboardCashFlowChart data={fluxo30Dias} />
            <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
              <MetricMini label="Recebimentos em aberto" value={brl(totalReceber)} tone="neutral" />
              <MetricMini label="Menor saldo previsto" value={brl(menorSaldo30)} tone={menorSaldo30 < 0 ? 'negative' : 'positive'} />
              <MetricMini label="Resultado em 30 dias" value={brl(saldoPrevisto30)} tone={saldoPrevisto30 < 0 ? 'negative' : 'positive'} />
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-950">O que mudou</h2>
                <span className="text-[11px] text-slate-400">vs. mês anterior</span>
              </div>
              <div className="mt-5 space-y-5">
                <ChangeRow label="Compras" value={variacaoCompras === null ? 'Sem histórico' : `${variacaoCompras >= 0 ? '+' : ''}${variacaoCompras.toFixed(0)}%`} progress={variacaoCompras === null ? 0 : Math.min(100, Math.abs(variacaoCompras))} tone={variacaoCompras !== null && variacaoCompras > 0 ? 'warning' : 'positive'} />
                <ChangeRow label="Contas vencidas" value={brl(cpVencidas)} progress={Math.min(100, percentualContasVencidas)} tone={cpVencidas > 0 ? 'negative' : 'positive'} />
                <ChangeRow label="Marketplace hoje" value={brl(totalMarketplaceHoje)} progress={totalHoje > 0 ? Math.min(100, (totalMarketplaceHoje / totalHoje) * 100) : 0} tone="positive" />
              </div>
            </div>
            <AskVargas context={{
              vendasHoje: totalHoje,
              quantidadeVendasHoje: qtdHoje,
              ticketMedioHoje,
              projecaoFechamento,
              variacaoRitmo,
              variacaoTicket,
              faturamentoMes: totalMes,
              contasReceber: totalReceber,
              contasReceberVencidas: crVencido,
              contasPagar: cpTotal,
              contasPagarVencidas: cpVencidas,
              saldoPrevisto30,
              comprasMes: totalComprasMes,
              variacaoCompras,
              percentualVendasSemCliente: percentualSemCliente,
              vendasMarketplaceHoje: totalMarketplaceHoje,
              produtoMaiorFaturamentoMes: liderFaturamento ? nomeProduto.get(liderFaturamento.produto_id) ?? null : null,
              produtoMaiorFaturamentoMesValor: Number(liderFaturamento?.faturamento ?? 0),
              produtoMaisVendidoMes: liderQuantidade ? nomeProduto.get(liderQuantidade.produto_id) ?? null : null,
              produtoMaisVendidoMesQuantidade: Number(liderQuantidade?.quantidade ?? 0),
              vendedorCampeaoMes: vendedorCampeao?.nome ?? null,
              vendedorCampeaoMesFaturamento: vendedorCampeao?.faturamento ?? 0,
              vendedorCampeaoMesVendas: vendedorCampeao?.vendas ?? 0,
            }} />
          </div>
        </section>
      )}

      {/* ── Contas a pagar detalhado ───────────────────────────────────────── */}
      {tem('contas_pagar') && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-slate-800 font-semibold">Contas a Pagar</h2>
            <p className="text-slate-400 text-xs mt-0.5">Situação atual dos vencimentos</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <InfoChip label="Vencidas" value={brl(cpVencidas)} cor={cpVencidas > 0 ? 'text-red-600' : 'text-slate-400'} />
            <InfoChip label="Vencendo hoje" value={brl(cpHoje)} cor={cpHoje > 0 ? 'text-amber-600' : 'text-slate-400'} />
            <InfoChip label="A vencer" value={brl(cpAVencer)} cor="text-slate-700" />
          </div>
        </div>
      )}

      {/* ── Compras do mês + Fornecedor que mais comprou ───────────────────── */}
      {temCompras && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-slate-800 font-semibold">Compras do mês</h2>
                <p className="text-slate-400 text-xs mt-0.5">Entradas manuais + XML/NF-e</p>
              </div>
              <FiltroMes mesSelecionado={mesValido} />
            </div>
            <div className="px-5 py-5">
              <p className="text-slate-900 text-2xl font-bold">{brl(totalComprasMes)}</p>
              <p className="text-xs mt-1 text-slate-500">
                {comprasMesAtual.length} nota{comprasMesAtual.length === 1 ? '' : 's'}
                {variacaoCompras !== null && (
                  <span className={variacaoCompras >= 0 ? 'text-red-500 ml-2' : 'text-emerald-500 ml-2'}>
                    {variacaoCompras >= 0 ? '▲' : '▼'} {Math.abs(variacaoCompras).toFixed(0)}% vs. mês anterior
                  </span>
                )}
              </p>
            </div>
          </div>

          {tem('fornecedores') && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-slate-800 font-semibold">Fornecedor que mais comprou</h2>
                <p className="text-slate-400 text-xs mt-0.5">No mês selecionado</p>
              </div>
              {rankingFornecedores.length === 0 ? (
                <p className="px-5 py-8 text-center text-slate-400 text-sm">Nenhuma compra neste mês.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {rankingFornecedores.map((f, i) => (
                    <div key={f.nome + i} className="flex items-center justify-between px-5 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-semibold text-slate-400 w-4">{i + 1}º</span>
                        <span className="text-sm text-slate-700 truncate">{f.nome}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-800 flex-shrink-0">{brl(f.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Vendas dos canais hoje ─────────────────────────────────────────── */}
      {tem('marketplace') && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-slate-800 font-semibold">Vendas dos Canais Hoje</h2>
            <p className="text-slate-400 text-xs mt-0.5">Comparativo entre os canais de venda da empresa</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <div className="px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl flex-shrink-0">🏬</div>
              <div className="min-w-0">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">PDV Externo</p>
                <p className="text-slate-400 text-lg font-bold truncate">—</p>
                <p className="text-slate-400 text-xs">sem integração ainda</p>
              </div>
            </div>
            <div className="px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center text-xl flex-shrink-0">🏪</div>
              <div className="min-w-0">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Marketplaces</p>
                <p className="text-slate-900 text-lg font-bold truncate">{brl(totalMarketplaceHoje)}</p>
                <p className="text-slate-400 text-xs truncate">
                  {canaisConectados.length === 0
                    ? 'nenhum canal conectado'
                    : `${qtdMarketplaceHoje} pedido${qtdMarketplaceHoje === 1 ? '' : 's'} · ${canaisConectados.map(c => c.nome).join(', ')}`}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Linha final: pulso de vendas / atalhos / financeiro / cadastros ─ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {temVendas && (
          <section className="lg:col-span-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="pulso-vendas-titulo">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="pulso-vendas-titulo" className="font-semibold text-slate-950">Pulso de vendas hoje</h2>
                <p className="mt-0.5 text-xs text-slate-500">Ritmo atual comparado às últimas oito semanas.</p>
              </div>
              <Link href="/dashboard/vendas" className="text-xs font-semibold text-indigo-600 transition-colors hover:text-indigo-700">
                Ver vendas →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
              <PulseMetric label="Vendido hoje" value={brl(totalHoje)} />
              <PulseMetric label="Transações" value={qtdHoje.toLocaleString('pt-BR')} />
              <PulseMetric label="Ticket médio" value={brl(ticketMedioHoje)} />
              <PulseMetric label="Projeção de fechamento" value={brl(projecaoFechamento)} accent />
            </div>
            <div className="grid xl:grid-cols-[minmax(0,1.65fr)_minmax(250px,.75fr)]">
              <div className="min-w-0 p-5">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Vendas acumuladas por horário</h3>
                    <p className="mt-0.5 text-[11px] text-slate-400">A projeção usa o comportamento dos mesmos dias da semana.</p>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-indigo-600" />Hoje</span>
                    <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t border-dashed border-slate-400" />Média histórica</span>
                  </div>
                </div>
                <SalesPulseChart data={pulsoVendas} />
              </div>
              <aside className="border-t border-slate-100 bg-slate-50/60 p-5 xl:border-l xl:border-t-0" aria-label="Sinais encontrados nas vendas de hoje">
                <h3 className="text-sm font-semibold text-slate-800">Sinais encontrados</h3>
                <div className="mt-4 space-y-4">
                  {sinaisPulso.slice(0, 3).map(sinal => <PulseSignalRow key={sinal.title} signal={sinal} />)}
                </div>
                <Link href="/dashboard/relatorios/vendas" className="mt-5 inline-flex text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                  Entender desempenho →
                </Link>
              </aside>
            </div>
          </section>
        )}

        <div className={`space-y-4 ${temVendas ? '' : 'lg:col-span-3'}`}>
          {ATALHOS.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Acesso rápido</p>
              <div className="grid grid-cols-2 gap-2">
                {ATALHOS.map(item => (
                  <Link key={item.href} href={item.href}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-colors ${item.color}`}>
                    <span className="text-xl">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(tem('contas_receber') || tem('contas_pagar')) && (
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 text-white">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Posição financeira</p>
              <div className="space-y-3">
                {tem('contas_receber') && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-slate-300 text-xs">A receber</span>
                    </div>
                    <span className="text-emerald-400 text-sm font-semibold">{brl(crPendente + crVencido)}</span>
                  </div>
                )}
                {tem('contas_pagar') && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-400" />
                      <span className="text-slate-300 text-xs">A pagar</span>
                    </div>
                    <span className="text-red-400 text-sm font-semibold">{brl(cpTotal)}</span>
                  </div>
                )}
                {tem('contas_receber') && tem('contas_pagar') && (
                  <>
                    <div className="h-px bg-slate-700" />
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 text-xs font-semibold">Saldo líquido</span>
                      <span className={`text-sm font-bold ${(crPendente + crVencido - cpTotal) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {brl(crPendente + crVencido - cpTotal)}
                      </span>
                    </div>
                  </>
                )}
              </div>
              {tem('relatorios_avancados') && (
                <Link href="/dashboard/relatorios/financeiro"
                  className="mt-4 block text-center text-xs text-slate-400 hover:text-white transition-colors">
                  Ver fluxo completo →
                </Link>
              )}
            </div>
          )}

          {(tem('produtos') || tem('clientes') || tem('fornecedores')) && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Cadastros</p>
              <div className="space-y-2">
                {tem('produtos') && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 text-sm">📦 Produtos ativos</span>
                    <span className="font-bold text-slate-800">{(produtosRes.count ?? 0).toLocaleString('pt-BR')}</span>
                  </div>
                )}
                {tem('clientes') && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 text-sm">👥 Clientes</span>
                    <span className="font-bold text-slate-800">{(clientesRes.count ?? 0).toLocaleString('pt-BR')}</span>
                  </div>
                )}
                {tem('fornecedores') && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 text-sm">🏭 Fornecedores</span>
                    <span className="font-bold text-slate-800">{(fornecedoresCountRes.count ?? 0).toLocaleString('pt-BR')}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, icon, accent, bg, href, alert, sparkline, sparklineLabel }: {
  label: string; value: string; sub?: string; icon: string
  accent: string; bg: string; href: string; alert?: boolean
  sparkline?: number[]; sparklineLabel?: string
}) {
  return (
    <Link href={href} className={`relative bg-gradient-to-br ${bg} rounded-2xl p-5 border border-slate-200/70 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all group overflow-hidden`}>
      {alert && (
        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      )}
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-lg shadow-sm ring-1 ring-slate-100">
          {icon}
        </div>
        <div className="h-1 w-12 rounded-full mt-2 opacity-40" style={{ background: accent }} />
      </div>
      <div className="relative z-10 min-h-14 pr-0 sm:pr-24">
        <p className="text-slate-500 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
        <p className="text-slate-900 text-xl font-bold tracking-tight leading-tight">{value}</p>
        {sub && (
          <p className="text-xs mt-1 font-medium" style={{ color: accent }}>{sub}</p>
        )}
      </div>
      {sparkline && sparklineLabel && (
        <div className="mt-3 flex justify-end sm:absolute sm:bottom-3 sm:right-3 sm:mt-0 sm:opacity-90">
          <KpiSparkline data={sparkline} color={accent} label={sparklineLabel} />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: accent }} />
    </Link>
  )
}

function InfoChip({ label, value, cor }: { label: string; value: string; cor: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${cor}`}>{value}</p>
    </div>
  )
}

const insightStyles: Record<InsightTone, { border: string; eyebrow: string; button: string; icon: string }> = {
  critical: {
    border: 'border-red-200', eyebrow: 'text-red-600', button: 'bg-red-600 hover:bg-red-700 text-white', icon: 'bg-red-50 text-red-600',
  },
  warning: {
    border: 'border-amber-200', eyebrow: 'text-amber-600', button: 'bg-amber-500 hover:bg-amber-600 text-white', icon: 'bg-amber-50 text-amber-600',
  },
  opportunity: {
    border: 'border-emerald-200', eyebrow: 'text-emerald-600', button: 'bg-emerald-600 hover:bg-emerald-700 text-white', icon: 'bg-emerald-50 text-emerald-600',
  },
}

function InsightCard({ insight }: { insight: Insight }) {
  const style = insightStyles[insight.tone]
  return (
    <article className={`flex min-h-64 flex-col rounded-2xl border bg-white p-5 shadow-sm ${style.border}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${style.icon}`} aria-hidden="true">!</span>
        <p className={`text-[11px] font-bold uppercase tracking-[0.16em] ${style.eyebrow}`}>{insight.eyebrow}</p>
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-950">{insight.title}</h3>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${style.eyebrow}`}>{insight.value}</p>
      <p className="mt-2 text-sm leading-5 text-slate-600">{insight.description}</p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <p className="max-w-[55%] text-[10px] leading-4 text-slate-400"><span className="block font-semibold text-slate-500">Evidência</span>{insight.evidence}</p>
        <Link href={insight.href} className={`rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${style.button}`}>{insight.action}</Link>
      </div>
    </article>
  )
}

function MetricMini({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'negative' | 'positive' }) {
  const color = tone === 'negative' ? 'text-red-600' : tone === 'positive' ? 'text-emerald-600' : 'text-slate-950'
  return (
    <div>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`mt-1 text-sm font-bold ${color}`}>{value}</p>
    </div>
  )
}

function ChangeRow({ label, value, progress, tone }: {
  label: string
  value: string
  progress: number
  tone: 'negative' | 'warning' | 'positive'
}) {
  const bar = tone === 'negative' ? 'bg-red-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-semibold text-slate-950">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(3, progress)}%` }} />
      </div>
    </div>
  )
}

function PulseMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold tracking-tight ${accent ? 'text-indigo-600' : 'text-slate-950'}`}>{value}</p>
    </div>
  )
}

const pulseSignalStyles: Record<PulseSignal['tone'], string> = {
  negative: 'bg-red-500',
  warning: 'bg-amber-500',
  positive: 'bg-emerald-500',
  neutral: 'bg-slate-400',
}

function PulseSignalRow({ signal }: { signal: PulseSignal }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${pulseSignalStyles[signal.tone]}`} />
      <div>
        <p className="text-xs font-semibold text-slate-800">{signal.title}</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">{signal.detail}</p>
      </div>
    </div>
  )
}

function SparklesIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.1 3.2a4 4 0 0 0 2.5 2.5L19 10l-3.4 1.2a4 4 0 0 0-2.5 2.5L12 17l-1.2-3.3a4 4 0 0 0-2.5-2.5L5 10l3.3-1.3a4 4 0 0 0 2.5-2.5L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m18.5 15 .5 1.4a2 2 0 0 0 1.2 1.2l1.3.4-1.3.5a2 2 0 0 0-1.2 1.2l-.5 1.3-.5-1.3a2 2 0 0 0-1.2-1.2l-1.3-.5 1.3-.4a2 2 0 0 0 1.2-1.2l.5-1.4Z" fill="currentColor" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
