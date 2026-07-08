import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { zapiSendText, zapiSendDocument } from '@/lib/zapi'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id, nome')
    .eq('id', user.id)
    .single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { data: cfg } = await supabase
    .from('whatsapp_config')
    .select('instance_id, token, client_token, url_base, ativo')
    .eq('empresa_id', empresaId)
    .single()

  if (!cfg || !cfg.ativo || !cfg.instance_id || !cfg.token)
    return NextResponse.json({ error: 'WhatsApp não configurado ou inativo' }, { status: 400 })

  const body = await request.json()
  const { telefone, mensagem, tipo = 'manual', cliente_id, cliente_nome, referencia_tipo, referencia_id, pdf_url } = body

  if (!telefone || !mensagem)
    return NextResponse.json({ error: 'Telefone e mensagem são obrigatórios' }, { status: 400 })

  // Verifica opt-out
  if (cliente_id) {
    const { data: cli } = await supabase
      .from('clientes')
      .select('opt_out_whatsapp')
      .eq('id', cliente_id)
      .single()
    if (cli?.opt_out_whatsapp)
      return NextResponse.json({ error: 'Cliente optou por não receber mensagens via WhatsApp' }, { status: 400 })
  }

  // Registra na fila
  const { data: msg } = await supabase.from('whatsapp_mensagens').insert({
    empresa_id: empresaId,
    cliente_id: cliente_id ?? null,
    cliente_nome: cliente_nome ?? null,
    telefone,
    tipo,
    conteudo: mensagem,
    conteudo_pdf_url: pdf_url ?? null,
    referencia_tipo: referencia_tipo ?? null,
    referencia_id: referencia_id ?? null,
    status: 'pendente',
    operador_nome: profile?.nome ?? null,
  }).select('id').single()

  const zapiCfg = {
    instanceId: cfg.instance_id,
    token: cfg.token,
    clientToken: cfg.client_token,
    urlBase: cfg.url_base,
  }

  try {
    const result = await zapiSendText(zapiCfg, telefone, mensagem)

    if (!result.success) {
      await supabase.from('whatsapp_mensagens').update({
        status: 'erro', tentativas: 1, erro: result.error, updated_at: new Date().toISOString(),
      }).eq('id', msg!.id)
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    // Envia PDF em seguida, se houver
    if (pdf_url) {
      await zapiSendDocument(zapiCfg, telefone, pdf_url, undefined, 'cupom.pdf')
    }

    await supabase.from('whatsapp_mensagens').update({
      status: 'enviado', tentativas: 1,
      zapi_message_id: result.messageId ?? null,
      enviado_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', msg!.id)

    await supabase.from('whatsapp_config').update({
      ultima_mensagem_enviada: new Date().toISOString(),
    }).eq('empresa_id', empresaId)

    return NextResponse.json({ success: true, messageId: result.messageId, logId: msg!.id })
  } catch (e: any) {
    await supabase.from('whatsapp_mensagens').update({
      status: 'erro', tentativas: 1, erro: e.message, updated_at: new Date().toISOString(),
    }).eq('id', msg!.id)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
