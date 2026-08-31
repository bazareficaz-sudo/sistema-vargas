import { createClient } from '@/lib/supabase/server'
import AlertasBIClient from '@/components/relatorios/AlertasBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { buscarTudo } from '@/lib/supabase/paginar'
import { inicioDoMes, inicioDoMesAnterior, inicioDeDiasAtras } from '@/lib/datas'

export const dynamic = 'force-dynamic'

type ProdutoAlerta = {
  id: string; nome: string; estoque: number | null; estoque_minimo: number | null
  preco_custo: number | null; preco_venda: number | null; ativo: boolean; categoria: string | null
}

export default async function RelatorioAlertasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicio30 = inicioDeDiasAtras(30, hoje)
  const inicio7 = inicioDeDiasAtras(7, hoje)

  const [
    produtos,
    vendidos30Res,
    vendidos7Res,
    contasPagarRes,
    contasReceberRes,
    vendasMesAtualRes,
    vendasMesAnteriorRes,
    clientesRes,
    entradasRes,
    entradasXmlRes,
    vendasPorClienteRes,
  ] = await Promise.all([
    // 14.263 produtos ativos, e o PostgREST entrega 1.000 por vez: sem
    // paginar, todo alerta de estoque desta tela falava de 7% do catalogo.
    buscarTudo<ProdutoAlerta>(
      (de, ate) => supabase.from('produtos')
        .select('id, nome, estoque, estoque_minimo, preco_custo, preco_venda, ativo, categoria')
        .eq('empresa_id', empresaId).eq('ativo', true).order('id').range(de, ate),
      { rotulo: 'produtos ativos (alertas)' },
    ),
    // Antes: buscar os ids das vendas e mandar todos num `.in('venda_id',...)`.
    // Quebrado em dois lugares — os ids ja vinham truncados em 1.000, e 2.016
    // UUIDs numa URL passam de qualquer limite de servidor. O agrupamento
    // pertence ao banco.
    supabase.rpc('produtos_vendidos', { p_empresa: empresaId, p_inicio: inicio30.toISOString() }),
    supabase.rpc('produtos_vendidos', { p_empresa: empresaId, p_inicio: inicio7.toISOString() }),
    supabase.from('contas_pagar').select('valor, status, vencimento, descricao').eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']),
    supabase.from('contas_receber').select('valor, status, vencimento').eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']),
    supabase.rpc('vendas_resumo', { p_empresa: empresaId, p_inicio: inicioDoMes(hoje).toISOString() }),
    supabase.rpc('vendas_resumo', { p_empresa: empresaId, p_inicio: inicioDoMesAnterior(hoje).toISOString(), p_fim: inicioDoMes(hoje).toISOString() }),
    supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).is('mesclado_em', null),
    supabase.from('entradas').select('id, status, valor_total').eq('empresa_id', empresaId).eq('status', 'confirmada').is('total_contas', null),
    // A mesma compra entra por duas portas. Contar só o lançamento manual
    // escondia as notas importadas que também ficaram sem conta a pagar.
    supabase.from('nfe_entradas').select('id, status, valor_total').eq('empresa_id', empresaId).eq('status', 'finalizada').is('dados_financeiro', null),
    supabase.rpc('vendas_por_cliente', { p_empresa: empresaId }),
  ])

  const somaPorProduto = (linhas: { produto_id: string; quantidade: number }[] | null) => {
    const mapa: Record<string, number> = {}
    for (const l of linhas ?? []) mapa[l.produto_id] = Number(l.quantidade ?? 0)
    return mapa
  }
  const vendidos30 = somaPorProduto(vendidos30Res.data)
  const vendidos7 = somaPorProduto(vendidos7Res.data)

  // Clientes VIP inativos (alta compra, sem comprar ha 60+ dias). O total e a
  // ultima compra de cada cliente vem agrupados do banco — antes saiam das
  // 1.000 primeiras vendas, o que rebaixava o gasto de quem compra ha mais
  // tempo e escondia a compra recente de quem ficou fora do corte.
  const clientes = (vendasPorClienteRes.data ?? []) as { cliente_id: string; total: number; ultima_compra: string }[]
  const totalsByCliente = clientes.map(c => Number(c.total ?? 0)).sort((a, b) => b - a)
  const limiteVip = totalsByCliente[Math.floor(totalsByCliente.length * 0.1)] ?? 0
  const clientesVipInativos = clientes.filter(c => {
    const dias = Math.floor((hoje.getTime() - new Date(c.ultima_compra).getTime()) / 86400000)
    return Number(c.total ?? 0) >= limiteVip && dias >= 60
  }).length

  // Gera alertas
  const alertas: {
    tipo: 'critico' | 'alerta' | 'info' | 'oportunidade'
    titulo: string; descricao: string; quantidade?: number; link?: string; valor?: string
  }[] = []

  // Estoque zerado
  const semEstoque = produtos.filter(p => Number(p.estoque ?? 0) <= 0)
  if (semEstoque.length > 0) alertas.push({
    tipo: 'critico', titulo: 'Produtos sem estoque',
    descricao: `${semEstoque.length} produtos ativos com estoque zerado (ruptura).`,
    quantidade: semEstoque.length, link: '/dashboard/relatorios/estoque',
  })

  // Abaixo do mínimo
  const abaixoMin = produtos.filter(p => Number(p.estoque ?? 0) < Number(p.estoque_minimo ?? 0) && Number(p.estoque_minimo ?? 0) > 0 && Number(p.estoque ?? 0) > 0)
  if (abaixoMin.length > 0) alertas.push({
    tipo: 'alerta', titulo: 'Estoque abaixo do mínimo',
    descricao: `${abaixoMin.length} produtos precisam de reposição urgente.`,
    quantidade: abaixoMin.length, link: '/dashboard/relatorios/estoque',
  })

  // Capital parado (sem venda em 90 dias)
  const comVenda90Set = new Set(Object.keys(vendidos30))
  const parados = produtos.filter(p => !comVenda90Set.has(p.id) && Number(p.estoque ?? 0) > 0)
  const capitalParado = parados.reduce((s, p) => s + Number(p.preco_custo ?? 0) * Number(p.estoque ?? 0), 0)
  if (parados.length > 0) alertas.push({
    tipo: 'alerta', titulo: 'Capital parado em estoque',
    descricao: `${parados.length} produtos sem venda nos últimos 30 dias.`,
    quantidade: parados.length, link: '/dashboard/relatorios/estoque',
    valor: capitalParado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  })

  // Contas vencidas a pagar
  const pagarVencido = (contasPagarRes.data ?? []).filter(c => c.status === 'vencido')
  const totalVencidoPagar = pagarVencido.reduce((s, c) => s + Number(c.valor ?? 0), 0)
  if (pagarVencido.length > 0) alertas.push({
    tipo: 'critico', titulo: 'Contas a pagar vencidas',
    descricao: `${pagarVencido.length} contas em atraso.`,
    quantidade: pagarVencido.length, link: '/dashboard/contas-pagar',
    valor: totalVencidoPagar.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  })

  // Contas vencidas a receber (inadimplência)
  const receberVencido = (contasReceberRes.data ?? []).filter(c => c.status === 'vencido')
  const totalVencidoReceber = receberVencido.reduce((s, c) => s + Number(c.valor ?? 0), 0)
  if (receberVencido.length > 0) alertas.push({
    tipo: 'alerta', titulo: 'Inadimplência — recebíveis vencidos',
    descricao: `${receberVencido.length} cobranças em atraso.`,
    quantidade: receberVencido.length, link: '/dashboard/contas-receber',
    valor: totalVencidoReceber.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  })

  // Queda de faturamento
  const fatMesAtual = Number((vendasMesAtualRes.data ?? [])[0]?.faturamento ?? 0)
  const fatMesAnt = Number((vendasMesAnteriorRes.data ?? [])[0]?.faturamento ?? 0)
  if (fatMesAnt > 0 && fatMesAtual < fatMesAnt * 0.8) {
    const queda = ((fatMesAnt - fatMesAtual) / fatMesAnt) * 100
    alertas.push({
      tipo: 'alerta', titulo: 'Queda no faturamento',
      descricao: `Faturamento ${queda.toFixed(0)}% abaixo do mês anterior. Investigate os motivos.`,
      link: '/dashboard/relatorios/vendas',
    })
  }

  // Clientes VIP inativos
  if (clientesVipInativos > 0) alertas.push({
    tipo: 'alerta', titulo: 'Clientes VIP sem comprar',
    descricao: `${clientesVipInativos} clientes de alto valor há mais de 60 dias sem comprar. Considere uma campanha de reativação.`,
    quantidade: clientesVipInativos, link: '/dashboard/relatorios/clientes',
  })

  // Entradas sem contas a pagar
  const entradasSemContas = (entradasRes.data ?? []).length + (entradasXmlRes.data ?? []).length
  if (entradasSemContas > 0) alertas.push({
    tipo: 'info', titulo: 'Entradas sem contas a pagar',
    descricao: `${entradasSemContas} entradas confirmadas sem contas a pagar geradas.`,
    quantidade: entradasSemContas, link: '/dashboard/entradas',
  })

  // Produto com giro acelerado (oportunidade de compra antecipada)
  const acelerados = produtos.filter(p => {
    const v7 = vendidos7[p.id] ?? 0
    const v30 = vendidos30[p.id] ?? 0
    const mediaD = v30 / 30
    const d7Rate = v7 / 7
    return v30 > 0 && d7Rate > mediaD * 1.5 && Number(p.estoque ?? 0) > 0
  })
  if (acelerados.length > 0) alertas.push({
    tipo: 'oportunidade', titulo: 'Produtos com giro acelerado',
    descricao: `${acelerados.length} produtos vendendo significativamente acima da média. Considere antecipar reposição.`,
    quantidade: acelerados.length, link: '/dashboard/relatorios/estoque',
  })

  // Oportunidade: produtos com alta margem
  const altaMargem = produtos.filter(p => {
    const margem = p.preco_custo && p.preco_venda ? (Number(p.preco_venda) - Number(p.preco_custo)) / Number(p.preco_venda) * 100 : 0
    return margem >= 40
  })
  if (altaMargem.length > 0) alertas.push({
    tipo: 'oportunidade', titulo: 'Produtos com alta margem disponíveis',
    descricao: `${altaMargem.length} produtos com margem ≥ 40%. Considere impulsioná-los nas vendas.`,
    quantidade: altaMargem.length, link: '/dashboard/relatorios/produtos',
  })

  return <AlertasBIClient alertas={alertas} totalProdutos={produtos.length} totalClientes={clientesRes.count ?? 0} />
}
