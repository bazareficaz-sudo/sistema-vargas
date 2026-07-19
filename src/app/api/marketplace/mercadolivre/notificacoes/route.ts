import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Endpoint de notificações (webhook) do Mercado Livre — cadastrado no painel
// de desenvolvedores como "URL de retorno de chamada de notificação".
// Formato do payload confirmado na doc pública deles (topic, resource,
// user_id, application_id, attempts, sent, received). O ML exige resposta
// rápida (HTTP 200) — se demorar ou falhar repetidamente, pode desativar o
// tópico. Por isso: sempre responde 200 na hora, e só tenta logar o evento
// como melhor esforço (falha ao logar não pode gerar erro de resposta).
//
// Hoje isso só REGISTRA o evento — o sync de pedidos/catálogo do sistema
// continua funcionando por consulta periódica (cron), não por reação a
// esse webhook. Se no futuro quisermos reagir em tempo real (ex: pedido
// novo via notificação em vez de esperar o próximo cron), a lógica entra
// aqui.
export async function POST(req: Request) {
  try {
    const payload = await req.json()
    const sellerId = payload?.user_id != null ? String(payload.user_id) : null

    if (sellerId) {
      const sb = createAdminClient()
      const { data: canal } = await sb
        .from('marketplace_canais')
        .select('id')
        .eq('plataforma', 'mercadolivre')
        .eq('seller_id', sellerId)
        .maybeSingle()

      if (canal) {
        await sb.from('marketplace_sync_log').insert({
          canal_id: canal.id,
          tipo: 'notificacao_ml',
          status: 'ok',
          mensagem: `Notificação recebida — tópico ${payload?.topic ?? 'desconhecido'}`,
          detalhes: payload,
        })
      }
    }
  } catch {
    // Nunca deixa o parse/log derrubar a resposta — o ML só precisa do 200.
  }

  return NextResponse.json({ ok: true })
}
