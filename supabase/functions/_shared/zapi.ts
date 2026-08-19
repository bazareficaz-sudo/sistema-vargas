// Cliente Z-API — porta de src/lib/zapi.ts (Next.js) pro runtime Deno das
// Edge Functions. Mantém o mesmo comportamento observado em produção pelo
// painel web (ex: send-document exige a extensão no path, não só no body —
// ver comentário em zapiSendDocument).

export interface ZAPIConfig {
  instanceId: string
  token: string
  clientToken?: string | null
  urlBase?: string | null
}

function buildUrl(config: ZAPIConfig, endpoint: string) {
  let base = (config.urlBase ?? 'https://api.z-api.io').replace(/\/$/, '')
  const instancesIdx = base.indexOf('/instances/')
  if (instancesIdx > 0) base = base.substring(0, instancesIdx)
  return `${base}/instances/${config.instanceId}/token/${config.token}/${endpoint}`
}

function headers(config: ZAPIConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.clientToken) h['Client-Token'] = config.clientToken
  return h
}

function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55') && digits.length >= 12) return digits
  return `55${digits}`
}

export async function zapiSendText(
  config: ZAPIConfig,
  phone: string,
  message: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(buildUrl(config, 'send-text'), {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ phone: cleanPhone(phone), message }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.value ?? data.error ?? `HTTP ${res.status}` }
    return { success: true, messageId: data.zaapId ?? data.messageId ?? data.id }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function zapiSendDocument(
  config: ZAPIConfig,
  phone: string,
  documentUrl: string,
  caption: string | undefined,
  fileName = 'documento.pdf',
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const extensao = (fileName.split('.').pop() || 'pdf').toLowerCase()
  try {
    const res = await fetch(buildUrl(config, `send-document/${extensao}`), {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ phone: cleanPhone(phone), document: documentUrl, caption, fileName }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.value ?? data.error ?? `HTTP ${res.status}` }
    return { success: true, messageId: data.zaapId ?? data.messageId ?? data.id }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function zapiSendImage(
  config: ZAPIConfig,
  phone: string,
  imageUrl: string,
  caption?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(buildUrl(config, 'send-image'), {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ phone: cleanPhone(phone), image: imageUrl, caption }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.value ?? data.error ?? `HTTP ${res.status}` }
    return { success: true, messageId: data.zaapId ?? data.messageId ?? data.id }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
