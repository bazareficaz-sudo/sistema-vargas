import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import ClienteDetalheClient from '@/components/contas-receber/ClienteDetalheClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function ClienteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: cliente } = await sb
    .from('clientes').select('*').eq('id', id).eq('empresa_id', empresaId).single()

  if (!cliente) notFound()

  // Estas tabelas só existem após rodar supabase-contas-receber.sql
  const [contasRes, creditosRes, historicoRes] = await Promise.all([
    sb.from('contas_receber')
      .select('*')
      .eq('cliente_id', id)
      .eq('empresa_id', empresaId)
      .order('data_vencimento', { ascending: false })
      .limit(100),
    sb.from('creditos_cliente')
      .select('*')
      .eq('cliente_id', id)
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false }),
    sb.from('cobranca_historico')
      .select('*')
      .eq('cliente_id', id)
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const contas   = contasRes.error   ? [] : (contasRes.data   ?? [])
  const creditos = creditosRes.error  ? [] : (creditosRes.data  ?? [])
  const historico= historicoRes.error ? [] : (historicoRes.data ?? [])

  // ── Compras do cliente ──────────────────────────────────────
  // O cruzamento venda_itens → vendas é feito à mão, em bloco: o PostgREST
  // desta base não reconhece essa relação (mesma nota de
  // EstoqueDetalhadoModal.tsx). Por isso duas consultas, não um join.
  const { data: vendasCli } = await sb.from('vendas')
    .select('id, numero, total, created_at, operador_nome, vendedor_nome, status')
    .eq('cliente_id', id).eq('empresa_id', empresaId).eq('status', 'concluida')
    .order('created_at', { ascending: false }).limit(300)

  const vendaIds = (vendasCli ?? []).map(v => v.id)
  const itensCli: any[] = []
  for (let i = 0; i < vendaIds.length; i += 200) {
    const { data } = await sb.from('venda_itens')
      .select('venda_id, produto_id, produto_nome, produto_sku, quantidade, preco_unitario, total, tipo')
      .in('venda_id', vendaIds.slice(i, i + 200))
    itensCli.push(...(data ?? []))
  }

  // Agregado por produto — o que este cliente realmente compra.
  const porProduto = new Map<string, { nome: string; sku: string | null; quantidade: number; valor: number; ultima: string }>()
  const dataDaVenda = new Map((vendasCli ?? []).map(v => [v.id, v.created_at]))
  for (const it of itensCli) {
    if (it.tipo === 'devolucao') continue
    const chave = it.produto_id ?? it.produto_nome
    const atual = porProduto.get(chave) ?? { nome: it.produto_nome, sku: it.produto_sku, quantidade: 0, valor: 0, ultima: '' }
    atual.quantidade += Number(it.quantidade ?? 0)
    atual.valor += Number(it.total ?? 0)
    const quando = dataDaVenda.get(it.venda_id) ?? ''
    if (quando > atual.ultima) atual.ultima = quando
    porProduto.set(chave, atual)
  }
  const produtosComprados = [...porProduto.values()].sort((a, b) => b.valor - a.valor)

  const itensPorVenda: Record<string, number> = {}
  for (const it of itensCli) {
    if (it.tipo === 'devolucao') continue
    itensPorVenda[it.venda_id] = (itensPorVenda[it.venda_id] ?? 0) + 1
  }
  const compras = (vendasCli ?? []).map(v => ({ ...v, qtdItens: itensPorVenda[v.id] ?? 0 }))

  // Preencher campos financeiros com defaults se ainda não existirem (SQL não rodado)
  const clienteCompleto = {
    permite_fiado: false,
    limite_credito: 0,
    saldo_devedor: 0,
    valor_vencido: 0,
    maior_atraso_dias: 0,
    bloqueado_fiado: false,
    motivo_bloqueio: null,
    observacoes_financeiras: null,
    data_ultima_compra_fiada: null,
    data_ultimo_pagamento: null,
    saldo_credito: 0,
    status_credito: 'liberado',
    cobranca_whatsapp_ativa: true,
    alerta_pedido_whatsapp: false,
    alerta_pedido_telefone: null,
    ...cliente,
  }

  return (
    <ClienteDetalheClient
      cliente={clienteCompleto}
      contasIniciais={contas}
      creditosIniciais={creditos}
      historicoIniciais={historico}
      compras={compras}
      produtosComprados={produtosComprados}
      empresaId={empresaId}
      operador={user.email ?? ''}
    />
  )
}
