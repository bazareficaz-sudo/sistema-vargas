import { zapiSendText, type ZAPIConfig } from '@/lib/zapi'

// Cache simples por empresa dentro de uma mesma execução do cron — evita
// buscar whatsapp_config repetidas vezes quando várias regras da mesma
// empresa disparam na mesma passada.
const cacheConfig = new Map<string, ZAPIConfig | null>()

async function carregarConfig(sb: any, empresaId: string): Promise<ZAPIConfig | null> {
  if (cacheConfig.has(empresaId)) return cacheConfig.get(empresaId)!
  const { data } = await sb.from('whatsapp_config')
    .select('instance_id, token, client_token, url_base, ativo')
    .eq('empresa_id', empresaId).single()
  const cfg = data?.ativo && data?.instance_id && data?.token
    ? { instanceId: data.instance_id, token: data.token, clientToken: data.client_token, urlBase: data.url_base }
    : null
  cacheConfig.set(empresaId, cfg)
  return cfg
}

export async function enviarWhatsappAutomacao(
  sb: any, empresaId: string, telefone: string, mensagem: string,
  meta: { tipo: string; cliente_id?: string | null; cliente_nome?: string | null; referencia_tipo?: string; referencia_id?: string }
): Promise<{ ok: boolean; erro?: string }> {
  if (!telefone) return { ok: false, erro: 'Sem número de destino' }

  const cfg = await carregarConfig(sb, empresaId)
  if (!cfg) return { ok: false, erro: 'WhatsApp não configurado ou inativo para esta empresa' }

  const { data: msg } = await sb.from('whatsapp_mensagens').insert({
    empresa_id: empresaId,
    cliente_id: meta.cliente_id ?? null,
    cliente_nome: meta.cliente_nome ?? null,
    telefone,
    tipo: `automacao_${meta.tipo}`,
    conteudo: mensagem,
    referencia_tipo: meta.referencia_tipo ?? 'automacao',
    referencia_id: meta.referencia_id ?? null,
    status: 'pendente',
  }).select('id').single()

  const resultado = await zapiSendText(cfg, telefone, mensagem)

  if (msg?.id) {
    await sb.from('whatsapp_mensagens').update(
      resultado.success
        ? { status: 'enviado', tentativas: 1, zapi_message_id: resultado.messageId ?? null, enviado_em: new Date().toISOString() }
        : { status: 'erro', tentativas: 1, erro: resultado.error }
    ).eq('id', msg.id)
  }

  return resultado.success ? { ok: true } : { ok: false, erro: resultado.error }
}
