import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { zapiSendText } from '@/lib/zapi'
import { montarMensagem } from '@/lib/whatsapp/envioCategoria'

// Envio por categoria: manda UMA mensagem do lote. Quem decide se pode (limite
// do dia, intervalo, horário, quem quer receber) é o banco, em
// whatsapp_lote_reservar(); aqui só se envia o que ele liberou e se grava o
// resultado. Sem resposta da Z-API = "incerto", nunca reenviado sozinho.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Reserva = { situacao: string; espera_s: number; item_id: string | null; cliente_id: string | null; nome: string | null; telefone: string | null; mensagem: string | null; enviados_hoje: number }

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const profile = await perfilDaSessao(supabase, user.id, 'empresa_id, nome')
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 400 })

  const { loteId } = await request.json().catch(() => ({})) as { loteId?: string }
  if (!loteId || !UUID.test(loteId)) return NextResponse.json({ error: 'Lote inválido' }, { status: 400 })

  const [{ data: cfg }, { data: empresa }] = await Promise.all([
    supabase.from('whatsapp_config').select('instance_id, token, client_token, url_base, ativo').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('empresas').select('nome, nome_fantasia').eq('id', empresaId).maybeSingle(),
  ])
  // Antes de reservar: sem WhatsApp configurado nada sai da fila.
  if (!cfg?.ativo || !cfg.instance_id || !cfg.token)
    return NextResponse.json({ error: 'WhatsApp não configurado ou inativo' }, { status: 400 })

  const { data: linhas, error: erroReserva } = await supabase.rpc('whatsapp_lote_reservar', { p_lote: loteId })
  if (erroReserva) return NextResponse.json({ error: erroReserva.message }, { status: 400 })
  const r = ((linhas ?? []) as Reserva[])[0]
  if (!r) return NextResponse.json({ error: 'Sem resposta do banco' }, { status: 500 })
  if (r.situacao !== 'ok' || !r.item_id || !r.telefone)
    return NextResponse.json({ situacao: r.situacao, espera_s: r.espera_s, enviados_hoje: r.enviados_hoje })

  const concluir = (status: 'enviado' | 'erro' | 'incerto', motivo?: string, mensagemId?: string) =>
    supabase.rpc('whatsapp_lote_concluir', { p_item: r.item_id, p_status: status, p_motivo: motivo ?? null, p_mensagem: mensagemId ?? null })

  const texto = montarMensagem(r.mensagem ?? '', r.nome, empresa?.nome_fantasia || empresa?.nome)
  const agora = () => new Date().toISOString()
  const { data: msg, error: erroLog } = await supabase.from('whatsapp_mensagens').insert({
    empresa_id: empresaId,
    cliente_id: r.cliente_id,
    cliente_nome: r.nome,
    telefone: r.telefone,
    tipo: 'envio_categoria',
    conteudo: texto,
    referencia_tipo: 'whatsapp_lote',
    referencia_id: loteId,
    status: 'pendente',
    operador_nome: profile?.nome ?? null,
  }).select('id').single()
  if (erroLog || !msg) {
    await concluir('erro', 'Não foi possível registrar a mensagem (nada foi enviado).')
    return NextResponse.json({ situacao: 'ok', resultado: 'erro', nome: r.nome, erro: 'Não foi possível registrar a mensagem.', enviados_hoje: r.enviados_hoje })
  }

  const zapi = { instanceId: cfg.instance_id, token: cfg.token, clientToken: cfg.client_token, urlBase: cfg.url_base }
  const envio = await zapiSendText(zapi, r.telefone, texto)
  const resultado = envio.success ? 'enviado' : envio.incerto ? 'incerto' : 'erro'
  const motivo = resultado === 'incerto'
    ? `Sem resposta da Z-API (${envio.error ?? 'tempo esgotado'}): pode ter saído ou não. Não reenviado.`
    : resultado === 'erro' ? (envio.error ?? 'Z-API recusou') : undefined

  await supabase.from('whatsapp_mensagens').update({
    status: envio.success ? 'enviado' : 'erro',
    tentativas: 1,
    erro: motivo ?? null,
    zapi_message_id: envio.messageId ?? null,
    enviado_em: envio.success ? agora() : null,
    updated_at: agora(),
  }).eq('id', msg.id)
  await concluir(resultado, motivo, msg.id)
  if (envio.success) await supabase.from('whatsapp_config').update({ ultima_mensagem_enviada: agora() }).eq('empresa_id', empresaId)

  return NextResponse.json({ situacao: 'ok', resultado, nome: r.nome, erro: motivo, enviados_hoje: r.enviados_hoje })
}
