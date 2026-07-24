import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { buscarPreapproval, listarPagamentos } from '@/lib/mercadopago/preapproval'
import AssinaturaClient from '@/components/assinatura/AssinaturaClient'

export default async function AssinaturaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: sub } = await supabase
    .from('subscriptions')
    .select(`
      id, status, trial_fim, data_fim, mercadopago_preapproval_id, mercadopago_status,
      plans!inner(nome, codigo, cor, preco_mensal, exige_pagamento_inicial,
        plan_modules(modulo)
      )
    `)
    .eq('empresa_id', empresaId)
    .single()

  if (!sub) {
    return <div className="p-6 text-slate-500">Nenhuma assinatura encontrada para esta empresa.</div>
  }

  const plano = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans as any
  const modulos = ((plano?.plan_modules as { modulo: string }[] | null) ?? []).map(m => m.modulo)

  let diasRestantes: number | null = null
  if (sub.status === 'trial' && sub.trial_fim) {
    diasRestantes = Math.max(0, Math.ceil((new Date(sub.trial_fim).getTime() - Date.now()) / 86400000))
  }

  let cobranca: any = null
  let pagamentos: any[] = []
  if (sub.mercadopago_preapproval_id) {
    try {
      cobranca = await buscarPreapproval(sub.mercadopago_preapproval_id)
      pagamentos = await listarPagamentos(sub.mercadopago_preapproval_id)
    } catch (e) {
      console.error('Erro ao buscar dados do Mercado Pago:', e)
    }
  }

  return (
    <AssinaturaClient
      plano={{
        nome: plano?.nome ?? '', codigo: plano?.codigo ?? '', cor: plano?.cor ?? '#3b82f6',
        precoMensal: plano?.preco_mensal ?? 0, exigePagamentoInicial: !!plano?.exige_pagamento_inicial,
        modulos,
      }}
      status={sub.status}
      trialFim={sub.trial_fim}
      diasRestantes={diasRestantes}
      cobranca={cobranca ? {
        proximoVencimento: cobranca.next_payment_date ?? null,
        ultimoValorCobrado: cobranca.summarized?.last_charged_amount ?? null,
        ultimaCobrancaEm: cobranca.summarized?.last_charged_date ?? null,
      } : null}
      pagamentos={pagamentos.map(p => ({
        id: p.id, data: p.date_created, valor: p.transaction_amount, status: p.status,
        statusPagamento: p.payment?.status ?? null,
      }))}
    />
  )
}
