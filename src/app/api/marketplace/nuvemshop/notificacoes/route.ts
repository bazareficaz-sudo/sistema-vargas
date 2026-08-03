import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getIntegracaoCredentials } from '@/lib/nuvemshop/client'
import { syncSinglePedido } from '@/lib/nuvemshop/orders'
import { COLUNAS_CANAL, montarCanal } from '@/lib/nuvemshop/canal'

export const dynamic = 'force-dynamic'

// Webhook da Nuvemshop: é o que faz o pedido chegar em tempo real, sem
// depender do robô. Chega sem sessão de usuário, então usa a chave de serviço
// — a autenticidade vem da assinatura, não de login.
//
// O corpo é sempre { store_id, event, id }. Eventos de pedido:
// order/created, order/paid, order/updated, order/packed, order/fulfilled,
// order/cancelled, order/edited, order/pending, order/voided.

const HEADER_ASSINATURA = 'x-linkedstore-hmac-sha256'

function assinaturaConfere(corpoBruto: string, assinaturaRecebida: string, appSecret: string): boolean {
  const esperada = crypto.createHmac('sha256', appSecret).update(corpoBruto, 'utf8').digest('hex')
  const a = Buffer.from(esperada, 'utf8')
  const b = Buffer.from(assinaturaRecebida, 'utf8')
  // Comparação de tempo constante: comparar com === vazaria, pelo tempo de
  // resposta, quantos caracteres iniciais o atacante já acertou.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  // O corpo precisa ser lido como texto puro: a assinatura é calculada sobre
  // os bytes exatos recebidos. Se passar por JSON.parse e voltar a
  // stringificar, a menor diferença de formatação invalida a conferência.
  const corpoBruto = await req.text()
  const assinatura = req.headers.get(HEADER_ASSINATURA) ?? ''

  let appSecret: string
  try {
    ({ appSecret } = await getIntegracaoCredentials())
  } catch {
    // Sem credenciais cadastradas não há como validar. Responde 200 para a
    // Nuvemshop não ficar reenviando indefinidamente algo que nunca vai passar.
    return NextResponse.json({ ok: false, motivo: 'credenciais-ausentes' })
  }

  if (!assinatura || !assinaturaConfere(corpoBruto, assinatura, appSecret)) {
    return NextResponse.json({ ok: false, erro: 'Assinatura inválida' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(corpoBruto)
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo inválido' }, { status: 400 })
  }

  const storeId = payload?.store_id != null ? String(payload.store_id) : null
  const evento: string = payload?.event ?? 'desconhecido'
  const recursoId = payload?.id != null ? String(payload.id) : null

  const sb = createAdminClient()

  const { data: canalRow } = storeId
    ? await sb.from('marketplace_canais').select(COLUNAS_CANAL)
        .eq('plataforma', 'nuvemshop').eq('seller_id', storeId).eq('ativo', true)
        .maybeSingle()
    : { data: null }

  if (!canalRow) {
    // Loja desconhecida (desconectada aqui, ainda instalada lá). 200 de
    // propósito: reenviar não resolveria.
    return NextResponse.json({ ok: false, motivo: 'canal-nao-encontrado', storeId })
  }

  const canal = montarCanal(canalRow)

  // Só eventos de pedido disparam trabalho nesta fase. Os demais ficam
  // registrados no log, sem processamento — assim dá para ver que chegaram.
  if (!evento.startsWith('order/') || !recursoId) {
    await sb.from('marketplace_sync_log').insert({
      canal_id: canal.id, tipo: 'webhook', status: 'ok',
      mensagem: `[webhook] Evento ${evento} recebido — sem processamento nesta fase`,
      detalhes: payload,
    })
    return NextResponse.json({ ok: true, ignorado: true, evento })
  }

  const resultado = await syncSinglePedido(sb, canal, recursoId)

  await sb.from('marketplace_sync_log').insert({
    canal_id: canal.id,
    tipo: 'webhook',
    status: resultado.ok ? 'ok' : 'erro',
    mensagem: resultado.ok
      ? `[webhook ${evento}] Pedido ${recursoId} sincronizado`
      : `[webhook ${evento}] Falha ao sincronizar pedido ${recursoId}: ${resultado.error}`,
    detalhes: { payload, resultado },
  })

  // Mesmo em falha, responde 200: a Nuvemshop reenvia em caso de erro, e o
  // robô de pedidos já é a rede de segurança. Devolver erro aqui geraria
  // reenvio em cima de um problema que reenviar não conserta (ex: produto
  // não mapeado).
  return NextResponse.json({ ok: resultado.ok, evento, pedido: recursoId })
}
