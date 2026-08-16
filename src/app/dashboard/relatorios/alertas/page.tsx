import { createClient } from '@/lib/supabase/server'
import AlertasBIClient from '@/components/relatorios/AlertasBIClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function RelatorioAlertasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date()
  const inicio30 = new Date(hoje); inicio30.setDate(inicio30.getDate() - 30); inicio30.setHours(0,0,0,0)
  const inicio7 = new Date(hoje); inicio7.setDate(inicio7.getDate() - 7); inicio7.setHours(0,0,0,0)
  const inicio90 = new Date(hoje); inicio90.setDate(inicio90.getDate() - 90)

  const [
    produtosRes,
    vendasIds30Res,
    vendasIds7Res,
    contasPagarRes,
    contasReceberRes,
    vendasMesAtualRes,
    vendasMesAnteriorRes,
    clientesRes,
    entradasRes,
    entradasXmlRes,
  ] = await Promise.all([
    supabase.from('produtos').select('id, nome, estoque, estoque_minimo, preco_custo, preco_venda, ativo, categoria').eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('vendas').select('id').eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', inicio30.toISOString()),
    supabase.from('vendas').select('id').eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', inicio7.toISOString()),
    supabase.from('contas_pagar').select('valor, status, vencimento, descricao').eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']),
    supabase.from('contas_receber').select('valor, status, vencimento').eq('empresa_id', empresaId).in('status', ['pendente', 'vencido']),
    supabase.from('vendas').select('total').eq('empresa_id', empresaId).eq('status', 'concluida')
      .gte('created_at', new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString()),
    supabase.from('vendas').select('total').eq('empresa_id', empresaId).eq('status', 'concluida')
      .gte('created_at', new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString())
      .lte('created_at', new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59).toISOString()),
    supabase.from('clientes').select('id').eq('empresa_id', empresaId),
    supabase.from('entradas').select('id, status, valor_total').eq('empresa_id', empresaId).eq('status', 'confirmada').is('total_contas', null),
    // A mesma compra entra por duas portas. Contar só o lançamento manual
    // escondia as notas importadas que também ficaram sem conta a pagar.
    supabase.from('nfe_entradas').select('id, status, valor_total').eq('empresa_id', empresaId).eq('status', 'finalizada').is('dados_financeiro', null),
  ])

  const produtos = produtosRes.data ?? []
  const ids30 = (vendasIds30Res.data ?? []).map(v => v.id)
  const ids7 = (vendasIds7Res.data ?? []).map(v => v.id)

  // Itens vendidos por produto nos últimos 30 e 7 dias
  const vendidos30: Record<string, number> = {}
  const vendidos7: Record<string, number> = {}

  if (ids30.length > 0) {
    const { data: itens30 } = await supabase.from('venda_itens').select('produto_id, quantidade').in('venda_id', ids30)
    for (const it of itens30 ?? []) vendidos30[it.produto_id] = (vendidos30[it.produto_id] ?? 0) + Number(it.quantidade ?? 0)
  }
  if (ids7.length > 0) {
    const { data: itens7 } = await supabase.from('venda_itens').select('produto_id, quantidade').in('venda_id', ids7)
    for (const it of itens7 ?? []) vendidos7[it.produto_id] = (vendidos7[it.produto_id] ?? 0) + Number(it.quantidade ?? 0)
  }

  // Clientes inativos VIP (alta compra, sem comprar há 60+ dias)
  const { data: vendasClientes } = await supabase
    .from('vendas').select('cliente_id, total, created_at')
    .eq('empresa_id', empresaId).eq('status', 'concluida')
  const clienteMap: Record<string, { total: number; ultima: string }> = {}
  for (const v of vendasClientes ?? []) {
    if (!v.cliente_id) continue
    if (!clienteMap[v.cliente_id]) clienteMap[v.cliente_id] = { total: 0, ultima: v.created_at }
    clienteMap[v.cliente_id].total += Number(v.total ?? 0)
    if (v.created_at > clienteMap[v.cliente_id].ultima) clienteMap[v.cliente_id].ultima = v.created_at
  }
  const totalsByCliente = Object.values(clienteMap).map(c => c.total).sort((a, b) => b - a)
  const limiteVip = totalsByCliente[Math.floor(totalsByCliente.length * 0.1)] ?? 0
  const clientesVipInativos = Object.entries(clienteMap)
    .filter(([, c]) => {
      const dias = Math.floor((hoje.getTime() - new Date(c.ultima).getTime()) / 86400000)
      return c.total >= limiteVip && dias >= 60
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
  const fatMesAtual = (vendasMesAtualRes.data ?? []).reduce((s, v) => s + Number(v.total ?? 0), 0)
  const fatMesAnt = (vendasMesAnteriorRes.data ?? []).reduce((s, v) => s + Number(v.total ?? 0), 0)
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

  return <AlertasBIClient alertas={alertas} totalProdutos={produtos.length} totalClientes={clientesRes.data?.length ?? 0} />
}
