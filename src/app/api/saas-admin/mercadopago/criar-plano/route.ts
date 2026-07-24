import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { criarPreapprovalPlan } from '@/lib/mercadopago/preapproval'

export async function POST(request: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Não autenticado.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: adminRow } = await admin.from('system_admins').select('id').eq('id', user.id).eq('ativo', true).maybeSingle()
  if (!adminRow) return NextResponse.json({ ok: false, error: 'Acesso restrito ao admin do sistema.' }, { status: 403 })

  const { planId } = await request.json()
  if (!planId) return NextResponse.json({ ok: false, error: 'planId é obrigatório.' }, { status: 400 })

  const { data: plano } = await admin.from('plans').select('id, nome, preco_mensal, mercadopago_plan_id').eq('id', planId).maybeSingle()
  if (!plano) return NextResponse.json({ ok: false, error: 'Plano não encontrado.' }, { status: 404 })
  if (plano.mercadopago_plan_id) return NextResponse.json({ ok: true, mercadopago_plan_id: plano.mercadopago_plan_id })

  const backUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.vargasnexus.com.br'}/assinatura/confirmacao`

  try {
    const mercadopagoPlanId = await criarPreapprovalPlan({ nome: plano.nome, preco_mensal: plano.preco_mensal }, backUrl)
    const { error } = await admin.from('plans').update({ mercadopago_plan_id: mercadopagoPlanId }).eq('id', planId)
    if (error) return NextResponse.json({ ok: false, error: 'Erro ao salvar: ' + error.message }, { status: 500 })
    return NextResponse.json({ ok: true, mercadopago_plan_id: mercadopagoPlanId })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? 'Erro ao criar plano no Mercado Pago.' }, { status: 500 })
  }
}
