import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { zapiSendImage } from '@/lib/zapi'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { numeroOculto } from '@/lib/whatsapp/contatos'
import { BUCKET_MIDIAS, referenciaGuardada } from '@/lib/whatsapp/midias'

// Imagem colada (Ctrl+V) ou escolhida na conversa. O navegador já subiu o
// arquivo para o bucket privado, na pasta <empresa>/<contato>/ (o RLS do
// Storage só deixa a pasta da própria empresa). Aqui: confere que o caminho é
// desta conversa, gera um link assinado curto para a Z-API buscar a imagem e
// registra no histórico. Uma imagem por envio, para a conversa aberta.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ARQUIVO = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const profile = await perfilDaSessao(supabase, user.id, 'empresa_id, nome')
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { contatoId, arquivo, legenda } = await request.json().catch(() => ({})) as { contatoId?: string; arquivo?: string; legenda?: string }
  if (!contatoId || !UUID.test(contatoId) || !arquivo || !ARQUIVO.test(arquivo))
    return NextResponse.json({ error: 'Imagem inválida' }, { status: 400 })
  const texto = String(legenda ?? '').trim().slice(0, 1000)

  const [{ data: contato }, { data: cfg }] = await Promise.all([
    supabase.from('whatsapp_conversas').select('id, telefone, cliente_id, cliente_nome')
      .eq('empresa_id', empresaId).eq('id', contatoId).maybeSingle(),
    supabase.from('whatsapp_config').select('instance_id, token, client_token, url_base, ativo')
      .eq('empresa_id', empresaId).maybeSingle(),
  ])
  if (!contato) return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
  if (numeroOculto(contato.telefone))
    return NextResponse.json({ error: 'O WhatsApp escondeu o número desta pessoa: responda pelo celular.' }, { status: 400 })
  if (!cfg?.ativo || !cfg.instance_id || !cfg.token)
    return NextResponse.json({ error: 'WhatsApp não configurado ou inativo' }, { status: 400 })
  if (contato.cliente_id) {
    const { data: cli } = await supabase.from('clientes').select('opt_out_whatsapp').eq('id', contato.cliente_id).maybeSingle()
    if (cli?.opt_out_whatsapp) return NextResponse.json({ error: 'Cliente optou por não receber mensagens via WhatsApp' }, { status: 400 })
  }

  // O caminho é montado aqui, não aceito pronto do navegador.
  const caminho = `${empresaId}/${contato.id}/${arquivo}`
  const { data: assinado, error: erroLink } = await supabase.storage.from(BUCKET_MIDIAS).createSignedUrl(caminho, 600)
  if (erroLink || !assinado?.signedUrl) return NextResponse.json({ error: 'Imagem não encontrada. Tente colar de novo.' }, { status: 404 })

  const agora = () => new Date().toISOString()
  const { data: msg, error: erroLog } = await supabase.from('whatsapp_mensagens').insert({
    empresa_id: empresaId,
    cliente_id: contato.cliente_id ?? null,
    cliente_nome: contato.cliente_nome ?? null,
    telefone: contato.telefone,
    tipo: 'atendimento',
    conteudo: texto ? `[foto] ${texto}` : '[foto]',
    conteudo_pdf_url: referenciaGuardada(caminho),
    status: 'pendente',
    operador_nome: profile?.nome ?? null,
  }).select('id').single()
  if (erroLog || !msg) return NextResponse.json({ error: 'Não foi possível registrar o envio' }, { status: 500 })

  const zapi = { instanceId: cfg.instance_id, token: cfg.token, clientToken: cfg.client_token, urlBase: cfg.url_base }
  const r = await zapiSendImage(zapi, contato.telefone, assinado.signedUrl, texto || undefined)

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
  return NextResponse.json({ success: true })
}
