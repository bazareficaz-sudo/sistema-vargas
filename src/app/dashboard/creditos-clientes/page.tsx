import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CreditosClienteClient from '@/components/contas-receber/CreditosClienteClient'

export const dynamic = 'force-dynamic'

export default async function CreditosClientePage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const [creditosRes, clientesRes, utilizacoesRes] = await Promise.all([
    sb.from('creditos_cliente')
      .select('*, clientes(nome, telefone, cpf_cnpj)')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false })
      .limit(300),
    sb.from('clientes')
      .select('id, nome, cpf_cnpj, telefone, saldo_credito')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      .order('nome'),
    sb.from('credito_utilizacoes')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  return (
    <CreditosClienteClient
      empresaId={empresaId}
      operador={user.email ?? ''}
      creditosIniciais={creditosRes.error    ? [] : (creditosRes.data    ?? [])}
      clientes={clientesRes.error     ? [] : (clientesRes.data     ?? [])}
      utilizacoesIniciais={utilizacoesRes.error ? [] : (utilizacoesRes.data ?? [])}
    />
  )
}
