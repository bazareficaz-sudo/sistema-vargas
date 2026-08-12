export interface ZAPIConfig {
  instanceId: string
  token: string
  clientToken?: string | null
  urlBase?: string | null
}

export interface ZAPIStatus {
  connected: boolean
  smartphoneConnected: boolean
  error?: string
}

function buildUrl(config: ZAPIConfig, endpoint: string) {
  let base = (config.urlBase ?? 'https://api.z-api.io').replace(/\/$/, '')
  // Sanitiza: se o usuário colou a URL completa (com /instances/), extrai só o host
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
  // Se já tem código do país (começa com 55 e tem 12-13 dígitos), retorna como está
  if (digits.startsWith('55') && digits.length >= 12) return digits
  // Adiciona +55 Brasil
  return `55${digits}`
}

export async function zapiStatus(config: ZAPIConfig): Promise<ZAPIStatus> {
  try {
    const res = await fetch(buildUrl(config, 'status'), {
      headers: headers(config),
      cache: 'no-store',
    })
    if (!res.ok) return { connected: false, smartphoneConnected: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    return {
      connected: data.connected ?? false,
      smartphoneConnected: data.smartphoneConnected ?? false,
    }
  } catch (e: any) {
    return { connected: false, smartphoneConnected: false, error: e.message }
  }
}

export async function zapiQrCode(config: ZAPIConfig): Promise<{ value: string | null; error?: string }> {
  try {
    const res = await fetch(buildUrl(config, 'qr-code'), {
      headers: headers(config),
      cache: 'no-store',
    })
    if (!res.ok) return { value: null, error: `HTTP ${res.status}` }
    const data = await res.json()
    return { value: data.value ?? null }
  } catch (e: any) {
    return { value: null, error: e.message }
  }
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
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function zapiSendDocument(
  config: ZAPIConfig,
  phone: string,
  documentUrl: string,
  caption?: string,
  fileName = 'documento.pdf',
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // A Z-API pede a extensão no CAMINHO: /send-document/pdf. Sem ela a
  // chamada não entrega o arquivo — era por isso que a mensagem de texto
  // chegava e o anexo nunca aparecia no WhatsApp do cliente.
  // https://developer.z-api.io/en/message/send-message-document
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
  } catch (e: any) {
    return { success: false, error: e.message }
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
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function zapiDisconnect(config: ZAPIConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(buildUrl(config, 'disconnect'), {
      headers: headers(config),
      cache: 'no-store',
    })
    return { success: res.ok }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function zapiRestart(config: ZAPIConfig): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(buildUrl(config, 'restart'), {
      headers: headers(config),
      cache: 'no-store',
    })
    return { success: res.ok }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

// Interpola variáveis no template
export function interpolarTemplate(template: string, variaveis: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => variaveis[key] ?? `{${key}}`)
}
