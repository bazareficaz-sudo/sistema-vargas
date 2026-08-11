import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { zapiSendImage, zapiSendText } from '@/lib/zapi'

// Envio de imagens do produto por WhatsApp.
//
// Cada imagem vai numa mensagem própria, com o seu título como legenda —
// é assim que o WhatsApp mostra texto junto da foto. Mandar todas as fotos
// e depois um texto com a lista deixaria o cliente sem saber qual legenda
// pertence a qual imagem.

export const maxDuration = 60

// Espaço entre mensagens. Rajada de imagens para o mesmo número é o padrão
// que mais chama atenção de bloqueio automático do WhatsApp.
const INTERVALO_MS = 1200

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, erro: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('empresa_id, nome').eq('id', user.id).single()
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não encontrada' }, { status: 400 })

  const { telefone, imagemIds, mensagemInicial } = await request.json() as {
    telefone?: string; imagemIds?: string[]; mensagemInicial?: string
  }

  if (!telefone) return NextResponse.json({ ok: false, erro: 'Informe o número de destino' }, { status: 400 })
  if (!Array.isArray(imagemIds) || imagemIds.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Selecione ao menos uma imagem' }, { status: 400 })
  }

  const { data: cfg } = await supabase
    .from('whatsapp_config')
    .select('instance_id, token, client_token, url_base, ativo')
    .eq('empresa_id', empresaId).single()

  if (!cfg?.ativo || !cfg.instance_id || !cfg.token) {
    return NextResponse.json({ ok: false, erro: 'WhatsApp não configurado ou inativo para esta empresa' }, { status: 400 })
  }
  const zapi = {
    instanceId: cfg.instance_id, token: cfg.token,
    clientToken: cfg.client_token, urlBase: cfg.url_base,
  }

  // Busca as imagens JÁ filtradas pela empresa do usuário: o id vem do
  // navegador e não pode ser palavra final sobre o que pode ser lido.
  const { data: imagens } = await supabase
    .from('produto_imagens')
    .select('id, url, titulo, ordem, produto_id')
    .eq('empresa_id', empresaId)
    .in('id', imagemIds)
    .order('ordem')

  if (!imagens?.length) {
    return NextResponse.json({ ok: false, erro: 'Nenhuma imagem encontrada para esta empresa' }, { status: 404 })
  }

  const resultados: { id: string; ok: boolean; erro?: string }[] = []

  // Mensagem de abertura, quando houver: o cliente entende o contexto antes
  // das fotos começarem a chegar.
  if (mensagemInicial?.trim()) {
    const r = await zapiSendText(zapi, telefone, mensagemInicial.trim())
    if (!r.success) {
      return NextResponse.json({ ok: false, erro: `Falha ao enviar a mensagem inicial: ${r.error}` }, { status: 502 })
    }
    await sleep(INTERVALO_MS)
  }

  for (const img of imagens) {
    const r = await zapiSendImage(zapi, telefone, img.url, img.titulo?.trim() || undefined)
    resultados.push({ id: img.id, ok: r.success, erro: r.error })

    // Registra no histórico de mensagens, igual ao envio de texto — sem isso
    // um envio por imagem some do rastro da empresa.
    await supabase.from('whatsapp_mensagens').insert({
      empresa_id: empresaId,
      telefone,
      conteudo: img.titulo?.trim() || '(imagem sem legenda)',
      conteudo_pdf_url: img.url,
      tipo: 'produto_imagem',
      referencia_tipo: 'produto',
      referencia_id: img.produto_id,
      status: r.success ? 'enviado' : 'erro',
      tentativas: 1,
      erro: r.success ? null : r.error,
      zapi_message_id: r.messageId ?? null,
      enviado_em: r.success ? new Date().toISOString() : null,
      operador_nome: profile?.nome ?? null,
    })

    await sleep(INTERVALO_MS)
  }

  const enviadas = resultados.filter(r => r.ok).length
  const falhas = resultados.filter(r => !r.ok)

  return NextResponse.json({
    ok: enviadas > 0,
    enviadas,
    falhas: falhas.length,
    // O motivo da primeira falha volta para a tela: "falhou" sem porquê não
    // ajuda ninguém a resolver.
    erro: enviadas === 0 ? (falhas[0]?.erro ?? 'Nenhuma imagem foi enviada') : undefined,
    detalhes: resultados,
  })
}
