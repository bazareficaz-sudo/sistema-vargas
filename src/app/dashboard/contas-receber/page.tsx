import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ContasReceberClient from '@/components/contas-receber/ContasReceberClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

export default async function ContasReceberPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const [contasRes, clientesRes, creditosRes] = await Promise.all([
    sb.from('contas_receber')
      .select('*')
      .eq('empresa_id', empresaId)
      .neq('status', 'cancelado')
      .order('data_vencimento', { ascending: true })
      .limit(500),
    sb.from('clientes')
      .select('id, nome, cpf_cnpj, telefone, saldo_credito, saldo_devedor, limite_credito, bloqueado_fiado')
      .eq('empresa_id', empresaId)
      .eq('ativo', true)
      // Cadastro unificado noutro não entra no filtro: ele continua no banco
      // pelo histórico, mas listá-lo faz o MESMO cliente aparecer duas vezes —
      // exatamente o que a tela de Clientes já evitava e esta não.
      .is('mesclado_em', null)
      .order('nome')
      .limit(500),
    sb.from('creditos_cliente')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('status', 'disponivel')
      .gt('saldo_disponivel', 0),
  ])

  const contas   = contasRes.error   ? [] : (contasRes.data   ?? [])
  const clientes = clientesRes.error  ? [] : (clientesRes.data  ?? [])
  const creditos = creditosRes.error  ? [] : (creditosRes.data  ?? [])

  return (
    <ContasReceberClient
      empresaId={empresaId}
      operador={user.email ?? ''}
      contasIniciais={contas}
      clientes={clientes}
      creditosDisponiveis={creditos}
    />
  )
}
