import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { buscarPreapproval } from '@/lib/mercadopago/preapproval'

// Valida o header x-signature (HMAC-SHA256) antes de confiar em qualquer
// coisa vinda do webhook. Formato documentado pelo Mercado Pago:
// x-signature: "ts=<timestamp>,v1=<hash>"
// manifest = `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
// (data.id em minúsculas se tiver letras). Testado contra o simulador de
// webhooks do Mercado Pago antes de confiar em produção — ver plano.
function assinaturaValida(xSignature: string | null, xRequestId: string | null, dataId: string | null): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (!secret || !xSignature || !dataId) return false

  const partes = Object.fromEntries(xSignature.split(',').map(p => {
    const [k, v] = p.split('=')
    return [k?.trim(), v?.trim()]
  }))
  const ts = partes.ts
  const v1 = partes.v1
  if (!ts || !v1) return false

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId ?? ''};ts:${ts};`
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  return hash === v1
}

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const body = await request.json().catch(() => ({}))
    const dataId = url.searchParams.get('data.id') ?? body?.data?.id ?? null
    const xSignature = request.headers.get('x-signature')
    const xRequestId = request.headers.get('x-request-id')

    if (!assinaturaValida(xSignature, xRequestId, dataId)) {
      console.error('Webhook Mercado Pago: assinatura inválida, ignorando.')
      return NextResponse.json({ ok: true })
    }

    const tipo = body.type ?? url.searchParams.get('type')
    if (tipo !== 'subscription_preapproval' || !dataId) {
      return NextResponse.json({ ok: true })
    }

    // Nunca confia no corpo da notificação — busca o status oficial na API.
    const preapproval = await buscarPreapproval(dataId)
    const statusMap: Record<string, string> = {
      authorized: 'active',
      cancelled: 'cancelled',
      paused: 'suspended',
      pending: 'pending',
    }
    const novoStatus = statusMap[preapproval.status]
    if (!novoStatus) return NextResponse.json({ ok: true })

    const admin = createAdminClient()

    // Não criamos a preapproval do nosso lado (o pagador autoriza direto no
    // Mercado Pago), então a primeira vez que vemos esse id precisamos
    // descobrir de qual assinatura ele é — casando pelo e-mail do pagador
    // contra o e-mail de quem se cadastrou. Depois disso, mercadopago_
    // preapproval_id já fica salvo e as próximas notificações usam ele.
    const { data: subExistente } = await admin.from('subscriptions')
      .select('id, empresa_id').eq('mercadopago_preapproval_id', dataId).maybeSingle()

    if (subExistente) {
      await admin.from('subscriptions')
        .update({ status: novoStatus, mercadopago_status: preapproval.status })
        .eq('id', subExistente.id)
      return NextResponse.json({ ok: true })
    }

    const payerEmail = preapproval.payer_email
    if (!payerEmail) {
      console.error(`Webhook Mercado Pago: preapproval ${dataId} sem payer_email, não consegui casar com nenhuma assinatura.`)
      return NextResponse.json({ ok: true })
    }

    const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const authUser = usersPage?.users.find(u => u.email?.toLowerCase() === payerEmail.toLowerCase())
    if (!authUser) {
      console.error(`Webhook Mercado Pago: nenhum usuário com e-mail ${payerEmail} encontrado para a preapproval ${dataId}.`)
      return NextResponse.json({ ok: true })
    }

    const { data: profile } = await admin.from('profiles').select('empresa_id').eq('id', authUser.id).maybeSingle()
    if (!profile?.empresa_id) {
      console.error(`Webhook Mercado Pago: usuário ${authUser.id} sem empresa vinculada.`)
      return NextResponse.json({ ok: true })
    }

    await admin.from('subscriptions')
      .update({ status: novoStatus, mercadopago_status: preapproval.status, mercadopago_preapproval_id: dataId })
      .eq('empresa_id', profile.empresa_id)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('Webhook Mercado Pago erro:', e.message)
    return NextResponse.json({ ok: true }) // sempre 200 para não gerar retentativa infinita
  }
}
