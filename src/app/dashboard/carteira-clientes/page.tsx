import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CarteiraClientesClient from '@/components/contas-receber/CarteiraClientesClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function CarteiraClientesPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const [clientesRes, contasRes, creditosRes, recebimentosRes] = await Promise.all([
    sb.from('clientes')
      .select('id, nome, cpf_cnpj, telefone, limite_credito, bloqueado_fiado, status_credito, permite_fiado, cobranca_whatsapp_ativa')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .order('nome')
      .limit(1000),
    sb.from('contas_receber')
      .select('id, cliente_id, valor_aberto, status, data_vencimento, numero_doc')
      .eq('empresa_id', empresaId)
      .in('status', ['aberto', 'parcial', 'vencido'])
      .limit(2000),
    sb.from('creditos_cliente')
      .select('cliente_id, saldo_disponivel')
      .eq('empresa_id', empresaId)
      .in('status', ['disponivel', 'parcial'])
      .gt('saldo_disponivel', 0)
      .limit(1000),
    sb.from('recebimentos')
      .select('cliente_id, created_at')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false })
      .limit(2000),
  ])

  const clientes = clientesRes.error ? [] : (clientesRes.data ?? [])
  const contas = contasRes.error ? [] : (contasRes.data ?? [])
  const creditos = creditosRes.error ? [] : (creditosRes.data ?? [])
  const recebimentos = recebimentosRes.error ? [] : (recebimentosRes.data ?? [])

  return (
    <CarteiraClientesClient
      clientes={clientes}
      contas={contas}
      creditos={creditos}
      recebimentos={recebimentos}
    />
  )
}
