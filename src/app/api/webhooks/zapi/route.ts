import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Webhook da Z-API — recebe eventos de mensagens e status
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = await createClient()

    // A Z-API envia o instanceId no corpo ou headers
    const instanceId = body.instanceId ?? body.instance ?? request.headers.get('x-instance-id')
    if (!instanceId) return NextResponse.json({ ok: true })

    // Busca empresa pelo instanceId
    const { data: cfg } = await supabase
      .from('whatsapp_config')
      .select('empresa_id')
      .eq('instance_id', instanceId)
      .single()

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

    // Mensagem recebida de cliente
    if (tipo === 'ReceivedCallback' || tipo === 'MessageReceived') {
      const phone = body.phone ?? body.from?.replace('@s.whatsapp.net', '')
      const text = body.text?.message ?? body.message?.text ?? ''

      if (phone) {
        // Busca cliente pelo telefone
        const phoneDigits = phone.replace(/\D/g, '').replace(/^55/, '')
        const { data: clientes } = await supabase
          .from('clientes')
          .select('id, nome')
          .eq('empresa_id', empresaId)
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
