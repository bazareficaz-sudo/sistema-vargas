// enviar-whatsapp-pdv — proxy seguro de envio de WhatsApp pro terminal PDV
// (VargasNexus, Electron). O terminal só tem a chave anônima do Supabase,
// então não pode ler `whatsapp_config` (guarda o token do Z-API) nem chamar
// a rota /api/whatsapp/enviar do painel (exige sessão logada de navegador).
// Esta function usa a service role (nunca sai daqui) pra buscar o token,
// checar opt-out do cliente, enviar via Z-API e registrar em
// whatsapp_mensagens — igual ao que a rota do painel já faz.
//
// Autenticação: chamada com a própria chave anônima no header Authorization
// (mesmo nível de confiança que o terminal já usa pra tudo mais no
// Supabase — nenhuma credencial sensível trafega até aqui).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { zapiSendText, zapiSendDocument, zapiSendImage, type ZAPIConfig } from '../_shared/zapi.ts'

const TIPOS_COBRANCA_WHATSAPP = ['extrato', 'atualizacao_conta', 'cobranca', 'lembrete_vencimento']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }

  const {
    empresa_id, telefone, mensagem, tipo = 'manual',
    cliente_id, cliente_nome, referencia_tipo, referencia_id, operador_nome,
    pdf_base64, pdf_filename, pdf_caption,
    fotos, // Array<{ url: string, caption?: string }> — catálogo de produtos
  } = body as Record<string, any>

  if (!empresa_id || !telefone) return json({ error: 'empresa_id e telefone são obrigatórios' }, 400)
  if (!mensagem && !pdf_base64 && !(Array.isArray(fotos) && fotos.length))
    return json({ error: 'Informe mensagem, pdf_base64 ou fotos' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: cfg } = await admin.from('whatsapp_config')
    .select('instance_id, token, client_token, url_base, ativo')
    .eq('empresa_id', empresa_id)
    .maybeSingle()

  if (!cfg || !cfg.ativo || !cfg.instance_id || !cfg.token)
    return json({ error: 'WhatsApp não configurado ou inativo para esta empresa' }, 400)

  if (cliente_id) {
    const { data: cli } = await admin.from('clientes')
      .select('opt_out_whatsapp, cobranca_whatsapp_ativa')
      .eq('id', cliente_id)
      .maybeSingle()
    if (cli?.opt_out_whatsapp)
      return json({ error: 'Cliente optou por não receber mensagens via WhatsApp' }, 400)
    if (TIPOS_COBRANCA_WHATSAPP.includes(tipo) && cli?.cobranca_whatsapp_ativa === false)
      return json({ error: 'Cliente desativou o recebimento de mensagens de cobrança' }, 400)
  }

  const { data: msg } = await admin.from('whatsapp_mensagens').insert({
    empresa_id, cliente_id: cliente_id ?? null, cliente_nome: cliente_nome ?? null,
    telefone, tipo, conteudo: mensagem ?? pdf_caption ?? '(anexo)',
    referencia_tipo: referencia_tipo ?? null, referencia_id: referencia_id ? String(referencia_id) : null,
    status: 'pendente', operador_nome: operador_nome ?? null,
  }).select('id').single()

  const zapiCfg: ZAPIConfig = {
    instanceId: cfg.instance_id, token: cfg.token,
    clientToken: cfg.client_token, urlBase: cfg.url_base,
  }

  try {
    let messageId: string | undefined
    let pdfUrl: string | null = null
    const falhas: string[] = []

    // PDF gerado localmente no terminal (cupom/NFC-e) — sobe pro storage
    // privado e vira link assinado de curta duração pro Z-API buscar.
    if (pdf_base64) {
      const bytes = Uint8Array.from(atob(pdf_base64), c => c.charCodeAt(0))
      const path = `${empresa_id}/${referencia_id || crypto.randomUUID()}-${Date.now()}.pdf`
      const { error: upErr } = await admin.storage.from('comprovantes-venda')
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error('Falha ao preparar PDF: ' + upErr.message)
      const { data: signed, error: signErr } = await admin.storage
        .from('comprovantes-venda').createSignedUrl(path, 600)
      if (signErr || !signed?.signedUrl) throw new Error('Falha ao gerar link do PDF')
      pdfUrl = signed.signedUrl
    }

    if (mensagem) {
      const r = await zapiSendText(zapiCfg, telefone, mensagem)
      if (!r.success) throw new Error(r.error || 'Falha ao enviar mensagem de texto')
      messageId = r.messageId
    }

    if (pdfUrl) {
      const r = await zapiSendDocument(zapiCfg, telefone, pdfUrl, pdf_caption ?? undefined, pdf_filename ?? 'documento.pdf')
      if (!r.success) falhas.push(`documento: ${r.error ?? 'falha desconhecida'}`)
      messageId = messageId ?? r.messageId
    }

    if (Array.isArray(fotos) && fotos.length) {
      let enviadas = 0
      for (const f of fotos) {
        if (!f?.url) continue
        const r = await zapiSendImage(zapiCfg, telefone, f.url, f.caption)
        if (r.success) { enviadas++; messageId = messageId ?? r.messageId }
      }
      if (enviadas < fotos.length) falhas.push(`fotos: ${enviadas}/${fotos.length} enviadas`)
    }

    await admin.from('whatsapp_mensagens').update({
      status: 'enviado', tentativas: 1,
      erro: falhas.length ? falhas.join(' · ') : null,
      zapi_message_id: messageId ?? null,
      conteudo_pdf_url: pdfUrl,
      enviado_em: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', msg!.id)

    await admin.from('whatsapp_config')
      .update({ ultima_mensagem_enviada: new Date().toISOString() })
      .eq('empresa_id', empresa_id)

    return json({ success: true, messageId, logId: msg!.id, falhas: falhas.length ? falhas : null })
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await admin.from('whatsapp_mensagens').update({
      status: 'erro', tentativas: 1, erro, updated_at: new Date().toISOString(),
    }).eq('id', msg!.id)
    return json({ error: erro }, 500)
  }
})
