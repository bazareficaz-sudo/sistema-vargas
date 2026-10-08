import { createHmac, timingSafeEqual } from 'node:crypto'
import { urlDoApp } from '@/lib/appUrl'

// A Z-API não assina o webhook: qualquer um que soubesse o id da instância
// poderia fingir uma mensagem do dono. Por isso o endereço que o sistema
// cadastra na Z-API leva uma chave (`?k=`) derivada do id da instância com um
// segredo do servidor — e o Getúlio só conversa quando ela confere.
//
// O resto do webhook (status de entrega, conexão) não depende da chave e
// continua funcionando como antes.

function segredo(): string {
  return process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

export function chaveWebhookZapi(instanceId: string): string {
  return createHmac('sha256', segredo()).update(`getulio:${instanceId}`).digest('hex').slice(0, 32)
}

export function chaveConfere(instanceId: string, k: string | null): boolean {
  if (!k || !segredo()) return false
  const esperada = Buffer.from(chaveWebhookZapi(instanceId))
  const recebida = Buffer.from(k)
  return esperada.length === recebida.length && timingSafeEqual(esperada, recebida)
}

export function urlWebhookZapi(instanceId: string): string {
  return urlDoApp(`/api/webhooks/zapi?k=${chaveWebhookZapi(instanceId)}`)
}
