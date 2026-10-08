import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { chaveConfere } from '@/lib/getulio/webhook'
import { getulioAtendeNumero, responderMensagem } from '@/lib/getulio/conversa'

// Webhook da Z-API — recebe eventos de mensagens e status.
//
// CLIENTE DE SERVIÇO, e não o da sessão: a Z-API chama sem login, e com o
// cliente da sessão a leitura de `whatsapp_config` voltava vazia pelas
// regras de acesso — o webhook descartava tudo em silêncio. Medido em
// 07/10/2026: nenhuma mensagem "recebida" registrada, nunca. O que limita a
// empresa aqui é o `instance_id`, que só a Z-API conhece.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createAdminClient()

    // A Z-API envia o instanceId no corpo ou headers
    const instanceId = body.instanceId ?? body.instance ?? request.headers.get('x-instance-id')
    if (!instanceId) return NextResponse.json({ ok: true })

    // Busca empresa pelo instanceId
    const { data: cfg } = await supabase
      .from('whatsapp_config')
      .select('empresa_id')
      .eq('instance_id', instanceId)
      .maybeSingle()

    if (!cfg) return NextResponse.json({ ok: true })

    const empresaId = cfg.empresa_id
    const tipo = body.type ?? body.event

    // Atualização de status de mensagem enviada
    if (tipo === 'DeliveryCallback' || tipo === 'ReadCallback' || tipo === 'MessageStatusCallback') {
      const messageId = body.messageId ?? body.zaapId
      const statusMap: Record<string, string> = {
        DELIVERY_ACK: 'entregue',
        READ: 'lido',
        PLAYED: 'lido',
        SENT: 'enviado',
      }
      const novoStatus = statusMap[body.status] ?? body.status?.toLowerCase()
      if (messageId && novoStatus) {
        await supabase.from('whatsapp_mensagens')
          .update({ status_entrega: novoStatus, updated_at: new Date().toISOString() })
          .eq('zapi_message_id', messageId)
          .eq('empresa_id', empresaId)
      }
      return NextResponse.json({ ok: true })
    }

    // Mensagem recebida
    if (tipo === 'ReceivedCallback' || tipo === 'MessageReceived') {
      // Mensagem que o próprio número mandou, de grupo ou de canal não é
      // conversa com a loja.
      if (body.fromMe || body.isGroup || body.isNewsletter || body.broadcast) return NextResponse.json({ ok: true })

      const phone = body.phone ?? body.from?.replace('@s.whatsapp.net', '')
      const text = body.text?.message ?? body.message?.text ?? ''

      if (phone) {
        // Busca cliente pelo telefone
        const phoneDigits = String(phone).replace(/\D/g, '').replace(/^55/, '')
        const { data: clientes } = await supabase
          .from('clientes')
          .select('id, nome')
          .eq('empresa_id', empresaId)
          // O telefone duplicado casa com os dois cadastros, e `.limit(1)`
          // pegava qualquer um. A mensagem tem que cair no que está vivo.
          .is('mesclado_em', null)
          .or(`telefone.ilike.%${phoneDigits}%,telefone_whatsapp.ilike.%${phoneDigits}%`)
          .limit(1)

        const cliente = clientes?.[0]

        // Registra mensagem recebida
        await supabase.from('whatsapp_mensagens').insert({
          empresa_id: empresaId,
          cliente_id: cliente?.id ?? null,
          cliente_nome: cliente?.nome ?? null,
          telefone: phone,
          tipo: 'recebida',
          conteudo: text || '[mídia]',
          status: 'recebida',
          enviado_em: new Date().toISOString(),
        })

        // GETÚLIO: só com a chave do endereço conferida (ver
        // lib/getulio/webhook.ts) e só para número cadastrado na Central. A
        // resposta roda depois do 200 — a Z-API não espera a IA pensar.
        if (text && chaveConfere(instanceId, request.nextUrl.searchParams.get('k'))) {
          const dono = await getulioAtendeNumero(supabase, empresaId, String(phone))
          if (dono) after(() => responderMensagem(supabase, empresaId, String(phone), dono, String(text)))
        }
      }
      return NextResponse.json({ ok: true })
    }

    // Status da instância (conectou/desconectou)
    if (tipo === 'StatusCallback' || tipo === 'ConnectionCallback') {
      const connected = body.connected ?? body.status === 'connected'
      await supabase.from('whatsapp_config').update({
        status_conexao: connected ? 'conectado' : 'desconectado',
        ultima_sincronizacao: new Date().toISOString(),
      }).eq('empresa_id', empresaId)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('Webhook Z-API erro:', e.message)
    return NextResponse.json({ ok: true }) // sempre 200 para não retentar
  }
}
