import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CobrancaClient from '@/components/contas-receber/CobrancaClient'

export const dynamic = 'force-dynamic'

export default async function CobrancaPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const [contasRes, historicoRes, clientesRes] = await Promise.all([
    sb.from('contas_receber')
      .select('*')
      .eq('empresa_id', empresaId)
      .in('status', ['vencido', 'aberto', 'parcial'])
      .lt('data_vencimento', new Date().toISOString().split('T')[0])
      .order('data_vencimento', { ascending: true })
      .limit(1000),
    sb.from('cobranca_historico')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('clientes')
      .select('id, nome, cpf_cnpj, telefone, saldo_devedor, valor_vencido, bloqueado_fiado')
      .eq('empresa_id', empresaId),
  ])

  return (
    <CobrancaClient
      empresaId={empresaId}
      operador={user.email ?? ''}
      contasVencidas={contasRes.error  ? [] : (contasRes.data   ?? [])}
      historicoInicial={historicoRes.error ? [] : (historicoRes.data ?? [])}
      clientes={clientesRes.error ? [] : (clientesRes.data ?? [])}
    />
  )
}
