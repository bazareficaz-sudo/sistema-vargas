import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncSinglePedido } from '@/lib/mercadolivre/orders'
import type { MLChannel } from '@/lib/mercadolivre/types'

// O trabalho agendado em after() (refresh de token + busca do pedido +
// upsert) conta dentro do tempo de vida da function, por isso um pouco mais
// de folga que o padrão.
export const maxDuration = 30

// Endpoint de notificações (webhook) do Mercado Livre — cadastrado no painel
// de desenvolvedores como "URL de retorno de chamada de notificação".
// Formato do payload confirmado na doc pública deles (topic, resource,
// user_id, application_id, attempts, sent, received). O ML exige resposta
// rápida (HTTP 200) — se demorar ou falhar repetidamente, pode desativar o
// tópico. Por isso: sempre responde 200 na hora, e a sincronização de verdade
// roda depois via `after()` (não bloqueia a resposta).
//
// Antes disso aqui só REGISTRAVA o evento e esperava o próximo cron de 5min
// pra buscar o pedido — na prática o cliente via a notificação chegando em
// tempo real nos logs mas o pedido só aparecia minutos depois (ou nunca, até
// alguém clicar "Sincronizar"). Tópico `orders_v2` já traz o id do pedido no
// `resource` (formato "/orders/{id}"), então dá pra buscar só ESSE pedido na
// hora em vez de esperar o cron varrer tudo de novo.
export async function POST(req: Request) {
  try {
    const payload = await req.json()
    const sellerId = payload?.user_id != null ? String(payload.user_id) : null
    const topic = payload?.topic ?? 'desconhecido'

    if (sellerId) {
      const sb = createAdminClient()
      const { data: canalRow } = await sb
        .from('marketplace_canais')
        .select('id, empresa_id, seller_id, access_token, refresh_token, token_expira_em, sincronizar_estoque, debitar_estoque_vendas')
        .eq('plataforma', 'mercadolivre')
        .eq('seller_id', sellerId)
        .maybeSingle()

      if (canalRow) {
        await sb.from('marketplace_sync_log').insert({
          canal_id: canalRow.id, tipo: 'notificacao_ml', status: 'ok',
          mensagem: `Notificação recebida — tópico ${topic}`, detalhes: payload,
        })

        const resource: string = payload?.resource ?? ''
        const orderId = topic === 'orders_v2' ? resource.split('/').filter(Boolean).pop() : null

        if (orderId) {
          const canal: MLChannel = {
            id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
            accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
            sincronizarEstoque: canalRow.sincronizar_estoque, debitarEstoqueVendas: canalRow.debitar_estoque_vendas,
          }
          after(async () => {
            const resultado = await syncSinglePedido(sb, canal, orderId)
            if (!resultado.ok) {
              await sb.from('marketplace_sync_log').insert({
                canal_id: canalRow.id, tipo: 'sync_pedidos', status: 'erro',
                mensagem: `[webhook orders_v2] Falha ao sincronizar pedido ${orderId}: ${resultado.error}`,
              })
            }
          })
        }
      }
    }
  } catch {
    // Nunca deixa o parse/log derrubar a resposta — o ML só precisa do 200.
  }

  return NextResponse.json({ ok: true })
}
