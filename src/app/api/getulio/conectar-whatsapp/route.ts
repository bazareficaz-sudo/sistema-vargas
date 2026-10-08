import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { guardaGetulio } from '@/lib/getulio/acesso'
import { urlWebhookZapi } from '@/lib/getulio/webhook'
import { zapiDefinirWebhookRecebimento } from '@/lib/zapi'

// Liga o RECEBIMENTO de mensagens: cadastra na Z-API o endereço do sistema
// como "Ao receber". Até 07/10/2026 esse endereço estava vazio — o sistema
// só enviava, e nenhuma mensagem recebida jamais chegou aqui.
export async function POST() {
  const { guarda } = await guardaGetulio()
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const admin = createAdminClient()
  const { data: wpp } = await admin.from('whatsapp_config')
    .select('instance_id, token, client_token, url_base, ativo').eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!wpp?.ativo || !wpp.instance_id || !wpp.token) {
    return NextResponse.json({ ok: false, erro: 'O WhatsApp da empresa não está configurado (Integrações → WhatsApp).' }, { status: 400 })
  }

  const url = urlWebhookZapi(wpp.instance_id)
  const r = await zapiDefinirWebhookRecebimento(
    { instanceId: wpp.instance_id, token: wpp.token, clientToken: wpp.client_token, urlBase: wpp.url_base }, url)
  if (!r.success) return NextResponse.json({ ok: false, erro: `A Z-API recusou: ${r.error ?? 'erro desconhecido'}` }, { status: 400 })

  await admin.from('whatsapp_config').update({ webhook_url: url, updated_at: new Date().toISOString() }).eq('empresa_id', guarda.empresaId)
  return NextResponse.json({ ok: true })
}
