import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkoutUrlDoPlano } from '@/lib/mercadopago/preapproval'

export async function POST() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Não autenticado.' }, { status: 401 })

  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('empresa_id').eq('id', user.id).maybeSingle()
  if (!profile?.empresa_id) return NextResponse.json({ ok: false, error: 'Empresa não encontrada para este usuário.' }, { status: 400 })

  const { data: sub } = await admin.from('subscriptions')
    .select('id, plan_id, plans(exige_pagamento_inicial, mercadopago_plan_id)')
    .eq('empresa_id', profile.empresa_id).maybeSingle()
  if (!sub) return NextResponse.json({ ok: false, error: 'Assinatura não encontrada.' }, { status: 400 })

  const plano = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans as any
  if (!plano?.exige_pagamento_inicial) return NextResponse.json({ ok: false, error: 'Este plano não exige pagamento inicial.' }, { status: 400 })
  if (!plano.mercadopago_plan_id) return NextResponse.json({ ok: false, error: 'Este plano ainda não está configurado no Mercado Pago. Fale com o suporte.' }, { status: 400 })

  // O cliente autoriza o pagamento numa página hospedada pelo Mercado Pago —
  // a preapproval em si é criada por eles quando o pagador confirma lá, não
  // por nós (confirmado ao vivo: POST /preapproval com plano associado
  // exige card_token_id, que exigiria um formulário de cartão no nosso
  // site). O webhook casa o pagamento com essa assinatura pelo e-mail do
  // pagador — ver src/app/api/webhooks/mercadopago/route.ts.
  return NextResponse.json({ ok: true, init_point: checkoutUrlDoPlano(plano.mercadopago_plan_id) })
}
