import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { preBaixarEtiqueta, COLUNAS_PRE_BAIXAR } from '@/lib/etiquetas/preBaixar'

// Robô de PRÉ-DOWNLOAD de etiquetas (ver src/lib/etiquetas/preBaixar.ts).
//
// A cada 10 minutos pega os pedidos em que o canal já deve ter liberado a
// etiqueta — e que ainda não foram impressos nem têm etiqueta guardada — e
// baixa. Quem o canal ainda recusa espera 30 minutos para a próxima
// tentativa, para não martelar a API com o mesmo pedido.
//
// "Já liberou", por canal:
//   Mercado Livre → shipment ready_to_ship / ready_to_print (nota aceita)
//   Shopee        → PROCESSED / RETRY_SHIP (envio organizado, com rastreio)
//   TikTok Shop   → AWAITING_COLLECTION, ou AWAITING_SHIPMENT com a nota já
//                   enviada (need_upload_invoice ≠ NEED_INVOICE)

export const maxDuration = 300

const POR_RODADA = 40
const ESPERA_APOS_FALHA_MIN = 30
const JANELA_DIAS = 20
const PRAZO_MS = 240_000

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }
  const inicio = Date.now()
  const admin = createAdminClient()
  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString()
  const esperaAte = new Date(Date.now() - ESPERA_APOS_FALHA_MIN * 60_000).toISOString()

  const { data: candidatos, error } = await admin.from('marketplace_pedidos')
    .select(`${COLUNAS_PRE_BAIXAR}, status_externo, envio_substatus, need_upload_invoice:dados_brutos->>need_upload_invoice`)
    .eq('status', 'confirmado')
    .is('etiqueta_arquivo', null)
    .is('etiqueta_impressa_em', null)
    .gte('data_pedido', desde)
    .or(`etiqueta_tentativa_em.is.null,etiqueta_tentativa_em.lt.${esperaAte}`)
    .or([
      'envio_substatus.eq.ready_to_print',
      'status_externo.in.(PROCESSED,RETRY_SHIP,AWAITING_COLLECTION)',
      'and(status_externo.eq.AWAITING_SHIPMENT,dados_brutos->>need_upload_invoice.neq.NEED_INVOICE)',
    ].join(','))
    .order('prazo_postagem', { ascending: true, nullsFirst: false })
    .limit(POR_RODADA)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const resumo = { baixadas: 0, ja_usadas: 0, indisponiveis: 0, ignorados: 0 }
  for (const p of (candidatos ?? []) as any[]) {
    if (Date.now() - inicio > PRAZO_MS) break
    // Canal desligado ou sem conexão: não é tarefa deste robô.
    if (!p.marketplace_canais?.access_token) { resumo.ignorados++; continue }
    const r = await preBaixarEtiqueta(admin, p)
    if (r.resultado === 'baixada') resumo.baixadas++
    else if (r.resultado === 'ja_usada') resumo.ja_usadas++
    else resumo.indisponiveis++
  }
  return NextResponse.json({ ok: true, candidatos: candidatos?.length ?? 0, ...resumo })
}
