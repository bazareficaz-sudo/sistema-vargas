import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { zapiSendImage, zapiSendText } from '@/lib/zapi'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { numeroOculto } from '@/lib/whatsapp/contatos'
import { legendaDoProduto } from '@/lib/whatsapp/conversas'

// Produto do estoque na conversa: a foto principal com nome, preço vigente
// (promoção só quando vale hoje) e código como legenda. Um produto por
// envio, para o contato que está aberto — nunca lista nem envio em massa.
//
// Contato e produto são lidos filtrando pela empresa de quem está logado:
// os ids vêm do navegador e não decidem sozinhos o que pode ser enviado.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(supabase, user.id, 'empresa_id, nome')
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { contatoId, produtoId } = await request.json().catch(() => ({})) as { contatoId?: string; produtoId?: string }
  if (!contatoId || !UUID.test(contatoId) || !produtoId || !UUID.test(produtoId))
    return NextResponse.json({ error: 'Conversa ou produto inválido' }, { status: 400 })

  const [{ data: contato }, { data: produto }, { data: cfg }] = await Promise.all([
    supabase.from('whatsapp_conversas').select('id, telefone, cliente_id, cliente_nome')
      .eq('empresa_id', empresaId).eq('id', contatoId).maybeSingle(),
    supabase.from('produtos')
      .select('id, nome, sku, unidade, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, ativo')
      .eq('empresa_id', empresaId).eq('id', produtoId).maybeSingle(),
    supabase.from('whatsapp_config').select('instance_id, token, client_token, url_base, ativo')
      .eq('empresa_id', empresaId).maybeSingle(),
  ])

  if (!contato) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
  if (numeroOculto(contato.telefone))
    return NextResponse.json({ error: 'O WhatsApp escondeu o número desta pessoa: responda pelo celular.' }, { status: 400 })
  if (!produto || produto.ativo === false) return NextResponse.json({ error: 'Produto não encontrado ou inativo' }, { status: 404 })
  if (!cfg?.ativo || !cfg.instance_id || !cfg.token)
    return NextResponse.json({ error: 'WhatsApp não configurado ou inativo' }, { status: 400 })

  // Mesmo respeito ao opt-out da rota de envio de texto.
  if (contato.cliente_id) {
    const { data: cli } = await supabase.from('clientes').select('opt_out_whatsapp').eq('id', contato.cliente_id).maybeSingle()
    if (cli?.opt_out_whatsapp) return NextResponse.json({ error: 'Cliente optou por não receber mensagens via WhatsApp' }, { status: 400 })
  }

  const { data: imagem } = await supabase.from('produto_imagens').select('url')
    .eq('empresa_id', empresaId).eq('produto_id', produto.id)
    .order('principal', { ascending: false }).order('ordem').limit(1).maybeSingle()

  const legenda = legendaDoProduto(produto)
  const agora = () => new Date().toISOString()

  // Registra antes de enviar: o que sair fica no histórico mesmo se a
  // resposta da Z-API se perder. O banco liga a mensagem à conversa.
  const { data: msg, error: erroLog } = await supabase.from('whatsapp_mensagens').insert({
    empresa_id: empresaId,
    cliente_id: contato.cliente_id ?? null,
    cliente_nome: contato.cliente_nome ?? null,
    telefone: contato.telefone,
    tipo: 'produto_individual',
    conteudo: legenda,
    conteudo_pdf_url: imagem?.url ?? null,
    referencia_tipo: 'produto',
    referencia_id: produto.id,
    status: 'pendente',
    operador_nome: profile?.nome ?? null,
  }).select('id').single()
  if (erroLog || !msg) return NextResponse.json({ error: 'Não foi possível registrar o envio' }, { status: 500 })

  const zapi = { instanceId: cfg.instance_id, token: cfg.token, clientToken: cfg.client_token, urlBase: cfg.url_base }
  const r = imagem?.url
    ? await zapiSendImage(zapi, contato.telefone, imagem.url, legenda)
    : await zapiSendText(zapi, contato.telefone, legenda)

  await supabase.from('whatsapp_mensagens').update({
    status: r.success ? 'enviado' : 'erro',
    tentativas: 1,
    erro: r.success ? null : (r.error ?? 'falha desconhecida'),
    zapi_message_id: r.messageId ?? null,
    enviado_em: r.success ? agora() : null,
    updated_at: agora(),
  }).eq('id', msg.id)

  if (!r.success) return NextResponse.json({ error: r.error ?? 'Não foi possível enviar' }, { status: 502 })
  await supabase.from('whatsapp_config').update({ ultima_mensagem_enviada: agora() }).eq('empresa_id', empresaId)
  return NextResponse.json({ success: true, comFoto: Boolean(imagem?.url) })
}
