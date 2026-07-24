import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarPreapproval, buscarPreapprovalsPorPlano } from '@/lib/mercadopago/preapproval'

const STATUS_MAP: Record<string, string> = {
  authorized: 'active',
  cancelled: 'cancelled',
  paused: 'suspended',
  pending: 'pending',
}

// Chamado pela página /assinatura/confirmacao logo que o cliente volta do
// checkout do Mercado Pago, e pelo banner de "pagamento pendente" antes de
// mandar o cliente pro checkout de novo. Existe porque o webhook sozinho não
// dá conta de linkar a PRIMEIRA autorização de uma assinatura: a API do
// Mercado Pago devolve payer_email vazio nesse fluxo de checkout hospedado
// (confirmado ao vivo), então não tem como casar pelo e-mail do pagador.
// Aqui a gente casa de outro jeito, mais confiável: o cliente está
// autenticado nessa mesma sessão que acabou de voltar do checkout, então dá
// pra procurar entre as preapprovals autorizadas desse plano qual ainda não
// está linkada a nenhuma assinatura — se sobrar exatamente uma candidata, é
// ela.
export async function POST() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Não autenticado.' }, { status: 401 })

  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('empresa_id').eq('id', user.id).maybeSingle()
  if (!profile?.empresa_id) return NextResponse.json({ ok: false, error: 'Empresa não encontrada.' }, { status: 400 })

  const { data: sub } = await admin.from('subscriptions')
    .select('id, status, mercadopago_preapproval_id, plan_id, plans(mercadopago_plan_id)')
    .eq('empresa_id', profile.empresa_id).maybeSingle()
  if (!sub) return NextResponse.json({ ok: false, error: 'Assinatura não encontrada.' }, { status: 400 })

  if (sub.status === 'active') {
    return NextResponse.json({ ok: true, status: 'active' })
  }

  // Já linkada antes (webhook chegou, ou reconciliação anterior) — só
  // atualiza o status oficial em vez de tentar linkar de novo.
  if (sub.mercadopago_preapproval_id) {
    const preapproval = await buscarPreapproval(sub.mercadopago_preapproval_id)
    const novoStatus = STATUS_MAP[preapproval.status]
    if (novoStatus && novoStatus !== sub.status) {
      await admin.from('subscriptions')
        .update({ status: novoStatus, mercadopago_status: preapproval.status })
        .eq('id', sub.id)
    }
    return NextResponse.json({ ok: true, status: novoStatus ?? sub.status })
  }

  const plano = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans as any
  if (!plano?.mercadopago_plan_id) {
    return NextResponse.json({ ok: true, status: sub.status })
  }

  const candidatas = await buscarPreapprovalsPorPlano(plano.mercadopago_plan_id)
  const autorizadas = candidatas.filter(p => p.status === 'authorized')
  if (autorizadas.length === 0) {
    return NextResponse.json({ ok: true, status: sub.status })
  }

  const { data: jaLinkadas } = await admin.from('subscriptions')
    .select('mercadopago_preapproval_id')
    .not('mercadopago_preapproval_id', 'is', null)
  const idsLinkados = new Set((jaLinkadas ?? []).map(s => s.mercadopago_preapproval_id))

  const semLink = autorizadas.filter(p => !idsLinkados.has(p.id))
  if (semLink.length === 0) {
    return NextResponse.json({ ok: true, status: sub.status })
  }
  if (semLink.length > 1) {
    // Mais de uma preapproval autorizada e sem dono pro mesmo plano — não dá
    // pra saber qual é qual sem arriscar linkar errado. Fica pendente pra
    // revisão manual (dá pra ver no console do Mercado Pago).
    console.error(`Reconciliação MP: ${semLink.length} preapprovals autorizadas sem link pro plano ${plano.mercadopago_plan_id}, não linkei nenhuma.`)
    return NextResponse.json({ ok: true, status: sub.status })
  }

  const escolhida = semLink[0]
  await admin.from('subscriptions')
    .update({ status: 'active', mercadopago_status: 'authorized', mercadopago_preapproval_id: escolhida.id })
    .eq('id', sub.id)

  return NextResponse.json({ ok: true, status: 'active' })
}
