import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { zapiSendText, zapiSendDocument } from '@/lib/zapi'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { ehTipoCobranca } from '@/lib/whatsapp/tiposCobranca'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(supabase, user.id, 'empresa_id, nome')
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
  const { telefone, mensagem, tipo = 'manual', cliente_id, cliente_nome, referencia_tipo, referencia_id, pdf_url, pdf_nome } = body

  if (!telefone || !mensagem)
    return NextResponse.json({ error: 'Telefone e mensagem são obrigatórios' }, { status: 400 })

  // Verifica opt-out (tudo) e, se for mensagem de cobrança, o toggle
  // específico de cobrança (extrato/situação da conta) — um cliente pode
  // continuar recebendo confirmação de pedido mas não lembrete de dívida.
  if (cliente_id) {
    const { data: cli } = await supabase
      .from('clientes')
      .select('opt_out_whatsapp, cobranca_whatsapp_ativa')
      .eq('id', cliente_id)
      .single()
    if (cli?.opt_out_whatsapp)
      return NextResponse.json({ error: 'Cliente optou por não receber mensagens via WhatsApp' }, { status: 400 })
    if (ehTipoCobranca(tipo) && cli?.cobranca_whatsapp_ativa === false)
      return NextResponse.json({ error: 'Cliente desativou o recebimento de mensagens de cobrança' }, { status: 400 })
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

    // Envia PDF em seguida, se houver. O resultado era descartado: quando o
    // anexo falhava, a rota devolvia sucesso e nada ficava registrado — o
    // texto chegava ao cliente e o arquivo não, sem ninguém saber.
    let anexoEnviado: boolean | null = null
    let anexoErro: string | null = null
    if (pdf_url) {
      const doc = await zapiSendDocument(zapiCfg, telefone, pdf_url, undefined, pdf_nome ?? 'documento.pdf')
      anexoEnviado = doc.success
      anexoErro = doc.success ? null : (doc.error ?? 'falha desconhecida ao enviar o anexo')
    }

    await supabase.from('whatsapp_mensagens').update({
      // O texto foi entregue, então o status continua 'enviado' — não invento
      // um valor novo que pode esbarrar num CHECK e derrubar o update. O que
      // faltou fica em `erro`, que é onde dá pra procurar depois.
      status: 'enviado',
      tentativas: 1,
      erro: anexoErro ? `Anexo não enviado: ${anexoErro}` : null,
      zapi_message_id: result.messageId ?? null,
      enviado_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', msg!.id)

    await supabase.from('whatsapp_config').update({
      ultima_mensagem_enviada: new Date().toISOString(),
    }).eq('empresa_id', empresaId)

    return NextResponse.json({
      success: true, messageId: result.messageId, logId: msg!.id,
      anexoEnviado, anexoErro,
    })
  } catch (e: any) {
    await supabase.from('whatsapp_mensagens').update({
      status: 'erro', tentativas: 1, erro: e.message, updated_at: new Date().toISOString(),
    }).eq('id', msg!.id)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
