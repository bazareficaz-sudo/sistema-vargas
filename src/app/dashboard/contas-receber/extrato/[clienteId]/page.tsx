import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ExtratoClienteClient from '@/components/contas-receber/ExtratoClienteClient'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

// Extrato da conta do cliente — o que ele comprou fiado e o que já pagou,
// em ordem cronológica e com saldo correndo, como um extrato bancário.
//
// Busca o histórico inteiro (não paginado de propósito): a conta de um
// cliente de balcão tem dezenas de linhas, não milhares, e o saldo corrente
// só faz sentido a partir do começo. O recorte por período acontece na tela,
// que consegue mostrar o saldo anterior sem uma segunda consulta.

export default async function ExtratoClientePage({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params
  const sb = await createClient()

  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(sb, user.id)
  const empresaId = profile?.empresa_id
  if (!empresaId) redirect('/dashboard')

  const { data: cliente } = await sb
    .from('clientes')
    .select('id, nome, cpf_cnpj, telefone, whatsapp, telefone_whatsapp, saldo_devedor, saldo_credito, limite_credito, bloqueado_fiado')
    .eq('id', clienteId).eq('empresa_id', empresaId).maybeSingle()

  // Cliente de outra empresa não existe do ponto de vista de quem está
  // logado — mesmo tratamento de "não encontrado", sem revelar a diferença.
  if (!cliente) redirect('/dashboard/contas-receber')

  const [contasRes, recebimentosRes] = await Promise.all([
    sb.from('contas_receber')
      .select('id, numero_doc, origem, origem_id, data_emissao, data_vencimento, valor_original, valor_recebido, valor_aberto, status, parcela_numero, total_parcelas, observacao, updated_at')
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId)
      .order('data_emissao', { ascending: true }),
    sb.from('recebimentos')
      .select('id, conta_id, valor, valor_liquido, desconto, juros, multa, forma_pagamento, observacao, operador_nome, created_at, data_recebimento')
      .eq('empresa_id', empresaId).eq('cliente_id', clienteId)
      .order('created_at', { ascending: true }),
  ])

  return (
    <ExtratoClienteClient
      cliente={cliente as any}
      contas={(contasRes.data ?? []) as any}
      recebimentos={(recebimentosRes.data ?? []) as any}
    />
  )
}
