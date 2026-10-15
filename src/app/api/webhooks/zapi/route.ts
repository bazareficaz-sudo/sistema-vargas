import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { chaveConfere } from '@/lib/getulio/webhook'
import { getulioAtendeNumero, responderMensagem } from '@/lib/getulio/conversa'
import { receberFotoProduto } from '@/lib/getulio/foto'
import { nomeDoRemetente, telefoneDoRemetente, textoDaMensagem } from '@/lib/whatsapp/contatos'
import { configZapi, preencherNomeDoContato } from '@/lib/whatsapp/nomes'
import { registrarEnviadaPeloCelular } from '@/lib/whatsapp/celular'

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
      .select('empresa_id, instance_id, token, client_token, url_base')
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
      // Grupo ou canal não é conversa com a loja.
      if (body.isGroup || body.isNewsletter || body.broadcast) return NextResponse.json({ ok: true })
      // Mensagem que a loja mandou pelo celular: entra na conversa (só com a
      // chave do endereço; o sistema não duplica o que ele mesmo enviou).
      if (body.fromMe) {
        const para = telefoneDoRemetente({ ...body, fromMe: false })
        if (para && chaveConfere(instanceId, request.nextUrl.searchParams.get('k'))) {
          const dados = { telefone: para, texto: textoDaMensagem(body), messageId: typeof body.messageId === 'string' ? body.messageId : null }
          after(() => registrarEnviadaPeloCelular(supabase, empresaId, dados))
        }
        return NextResponse.json({ ok: true })
      }

      const phone = body.phone ?? body.from?.replace('@s.whatsapp.net', '')
      const text = body.text?.message ?? body.message?.text ?? ''
      // Foto: a Z-API manda o link (temporário) e a legenda em `image`.
      const imagemUrl: string | null = body.image?.imageUrl ?? null
      const legenda: string = body.image?.caption ?? ''

      if (phone) {
        const chaveOk = chaveConfere(instanceId, request.nextUrl.searchParams.get('k'))

        // CONTATO (pré-cadastro): só com a chave do endereço conferida — sem
        // ela, qualquer um que soubesse o id da instância criaria contatos
        // falsos. A função já procura o cliente pelo telefone (com e sem 55
        // e o 9 extra) e ignora o dono e a equipe (destinatários do Getúlio).
        // Erro aqui (ex.: migração ainda não aplicada) não para o webhook.
        const remetente = telefoneDoRemetente(body)
        let contato: { contato_id: string | null; cliente_id: string | null; cliente_nome: string | null; interno: boolean } | null = null
        if (chaveOk && remetente) {
          const { data, error } = await supabase.rpc('whatsapp_registrar_contato', {
            p_empresa: empresaId, p_telefone: remetente, p_nome: nomeDoRemetente(body), p_texto: textoDaMensagem(body),
          })
          if (error) console.error('Contato WhatsApp:', error.message)
          else contato = data?.[0] ?? null
          // Mensagem sem o nome do remetente: pergunta à Z-API depois do 200.
          const config = configZapi(cfg)
          const contatoId = contato?.contato_id
          if (contatoId && config && !nomeDoRemetente(body)) after(() => preencherNomeDoContato(supabase, config, contatoId, remetente).then(() => undefined))
        }

        let cliente: { id: string; nome: string } | null = contato?.cliente_id ? { id: contato.cliente_id, nome: contato.cliente_nome ?? '' } : null
        if (!contato) {
          // Busca cliente pelo telefone (caminho antigo, sem contato registrado).
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
          cliente = clientes?.[0] ?? null
        }

        // Registra mensagem recebida
        await supabase.from('whatsapp_mensagens').insert({
          empresa_id: empresaId,
          cliente_id: cliente?.id ?? null,
          cliente_nome: cliente?.nome || null,
          telefone: phone,
          tipo: 'recebida',
          conteudo: textoDaMensagem(body),
          status: 'recebida',
          enviado_em: new Date().toISOString(),
          // Só com o contato registrado (a coluna vem na mesma migração).
          ...(contato?.contato_id ? { contato_id: contato.contato_id } : {}),
        })

        // BETINA: só com a chave do endereço conferida (ver
        // lib/getulio/webhook.ts) e só para número cadastrado na Central. A
        // resposta roda depois do 200 — a Z-API não espera a IA pensar.
        if ((text || imagemUrl) && chaveOk) {
          const dono = await getulioAtendeNumero(supabase, empresaId, String(phone))
          // Foto vai para o cadastro do produto da legenda; texto, para a conversa.
          if (dono && imagemUrl) after(() => receberFotoProduto(supabase, empresaId, String(phone), imagemUrl, legenda))
          else if (dono && text) after(() => responderMensagem(supabase, empresaId, String(phone), dono, String(text)))
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
