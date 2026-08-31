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

  const hoje = new Date().toISOString().split('T')[0]
  const em30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

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

  // Dashboard metrics
  const contasArr = contas
  const totalAberto = contasArr.filter(c => ['aberto', 'parcial'].includes(c.status)).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
  const totalVencido = contasArr.filter(c => c.status === 'vencido').reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
  const totalHoje    = contasArr.filter(c => c.data_vencimento === hoje && ['aberto','parcial','vencido'].includes(c.status)).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
  const totalEm30    = contasArr.filter(c => c.data_vencimento <= em30 && ['aberto','parcial'].includes(c.status)).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)

  return (
    <ContasReceberClient
      empresaId={empresaId}
      operador={user.email ?? ''}
      contasIniciais={contasArr}
      clientes={clientes}
      creditosDisponiveis={creditos}
      metricas={{ totalAberto, totalVencido, totalHoje, totalEm30 }}
    />
  )
}
