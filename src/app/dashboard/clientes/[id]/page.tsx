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
    ...cliente,
  }

  return (
    <ClienteDetalheClient
      cliente={clienteCompleto}
      contasIniciais={contas}
      creditosIniciais={creditos}
      historicoIniciais={historico}
      empresaId={empresaId}
      operador={user.email ?? ''}
    />
  )
}
