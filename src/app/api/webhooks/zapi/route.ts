import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type MidiaRecebida = { url: string; mime: string; caption?: string; kind: 'image' | 'audio' | 'video' | 'document' }

// Extrai a mídia de um evento de mensagem recebida da Z-API (imagem, áudio,
// vídeo ou documento). Retorna null quando é só texto.
function extrairMidia(body: any): MidiaRecebida | null {
  if (body?.image?.imageUrl) return { url: body.image.imageUrl, mime: body.image.mimeType || 'image/jpeg', caption: body.image.caption, kind: 'image' }
  if (body?.audio?.audioUrl) return { url: body.audio.audioUrl, mime: body.audio.mimeType || 'audio/ogg', kind: 'audio' }
  if (body?.video?.videoUrl) return { url: body.video.videoUrl, mime: body.video.mimeType || 'video/mp4', caption: body.video.caption, kind: 'video' }
  if (body?.document?.documentUrl) return { url: body.document.documentUrl, mime: body.document.mimeType || 'application/pdf', caption: body.document.caption || body.document.fileName, kind: 'document' }
  return null
}

function extDeMime(mime: string, kind: MidiaRecebida['kind']): string {
  const m = (mime || '').split(';')[0].trim().toLowerCase()
  const mapa: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
    'video/mp4': 'mp4', 'application/pdf': 'pdf',
  }
  return mapa[m] ?? (kind === 'image' ? 'jpg' : kind === 'audio' ? 'ogg' : kind === 'video' ? 'mp4' : 'bin')
}

function rotuloMidia(kind: MidiaRecebida['kind']): string {
  return kind === 'image' ? '[imagem]' : kind === 'audio' ? '[áudio]' : kind === 'video' ? '[vídeo]' : '[documento]'
}

// Baixa a mídia (URL temporária da Z-API) e regrava no bucket privado
// whatsapp-midias, pasta da empresa. Retorna o caminho salvo, ou null.
async function armazenarMidia(empresaId: string, midia: MidiaRecebida): Promise<string | null> {
  try {
    const resp = await fetch(midia.url)
    if (!resp.ok) return null
    const bytes = new Uint8Array(await resp.arrayBuffer())
    const ext = extDeMime(midia.mime, midia.kind)
    const contentType = (midia.mime || '').split(';')[0].trim() || 'application/octet-stream'
    const path = `${empresaId}/recebidas/${crypto.randomUUID()}.${ext}`
    const admin = createAdminClient()
    const up = await admin.storage.from('whatsapp-midias').upload(path, bytes, { contentType, upsert: false })
    if (up.error) return null
    return path
  } catch {
    return null
  }
}

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
          // O telefone duplicado casa com os dois cadastros, e `.limit(1)`
          // pegava qualquer um. A mensagem tem que cair no que está vivo.
          .is('mesclado_em', null)
          .or(`telefone.ilike.%${phoneDigits}%,telefone_whatsapp.ilike.%${phoneDigits}%`)
          .limit(1)

        const cliente = clientes?.[0]

        // Mídia recebida (foto/áudio/documento/vídeo): baixa e regrava no bucket
        // privado; a referência wamidia: é exibida pelo app e pelo CRM.
        const midia = extrairMidia(body)
        let conteudoPdfUrl: string | null = null
        let conteudo = text || ''
        if (midia) {
          const path = await armazenarMidia(empresaId, midia)
          if (path) conteudoPdfUrl = `wamidia:${path}`
          if (!conteudo) conteudo = midia.caption || rotuloMidia(midia.kind)
        }

        // Registra mensagem recebida
        await supabase.from('whatsapp_mensagens').insert({
          empresa_id: empresaId,
          cliente_id: cliente?.id ?? null,
          cliente_nome: cliente?.nome ?? null,
          telefone: phone,
          tipo: 'recebida',
          conteudo: conteudo || '[mídia]',
          conteudo_pdf_url: conteudoPdfUrl,
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
