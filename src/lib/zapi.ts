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
  // Grupo não é telefone: "120363...-group" (formato atual da Z-API) ou
  // "5511...-1623281429" (antigo). Tirar os não-dígitos viraria um número
  // inexistente — vai como veio.
  // Telefone formatado ("85 99999-1234") também tem hífen — por isso o
  // teste é pelo formato inteiro, não pela presença do hífen.
  const bruto = phone.trim()
  if (/-group$/i.test(bruto) || /@g\.us$/i.test(bruto) || /^\d{10,15}-\d{9,11}$/.test(bruto)) return bruto
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
  /** Id (WhatsApp) da mensagem respondida: sai citada, como o "Responder" do celular. */
  responderA?: string | null,
): Promise<{ success: boolean; messageId?: string; error?: string; incerto?: boolean }> {
  let recusou = false
  try {
    const res = await fetch(buildUrl(config, 'send-text'), {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ phone: cleanPhone(phone), message, ...(responderA ? { messageId: responderA } : {}) }),
      signal: AbortSignal.timeout(30_000),
    })
    recusou = !res.ok
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.value ?? data.error ?? `HTTP ${res.status}` }
    return { success: true, messageId: data.messageId ?? data.zaapId ?? data.id }
  } catch (e: any) {
    // Sem resposta (queda, tempo esgotado) ou resposta 200 ilegível: pode ter
    // saído ou não — `incerto`, para quem chama não reenviar sozinho.
    return { success: false, error: e.message, incerto: !recusou }
  }
}

/**
 * Define o endereço que a Z-API chama quando CHEGA uma mensagem no número
 * ("Ao receber" no painel da Z-API). É uma configuração única da instância:
 * se outro sistema estiver recebendo por ali, ele deixa de receber.
 */
export async function zapiDefinirWebhookRecebimento(
  config: ZAPIConfig, url: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(buildUrl(config, 'update-webhook-received'), {
      method: 'PUT',
      headers: headers(config),
      body: JSON.stringify({ value: url }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.value === false) return { success: false, error: data?.error ?? data?.message ?? `HTTP ${res.status}` }
    return { success: true }
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
    return { success: true, messageId: data.messageId ?? data.zaapId ?? data.id }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function zapiSendImage(
  config: ZAPIConfig,
  phone: string,
  imageUrl: string,
  caption?: string,
  /** Id (WhatsApp) da mensagem respondida. */
  responderA?: string | null,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(buildUrl(config, 'send-image'), {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ phone: cleanPhone(phone), image: imageUrl, caption, ...(responderA ? { messageId: responderA } : {}) }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.value ?? data.error ?? `HTTP ${res.status}` }
    return { success: true, messageId: data.messageId ?? data.zaapId ?? data.id }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export type GrupoWhatsapp = { id: string; nome: string }

/**
 * Grupos de que o número da empresa participa — para escolher na tela em vez
 * de digitar o ID. Tenta `/groups`; se a instância não tiver o recurso, cai
 * para `/chats` e filtra os grupos.
 */
export async function zapiListarGrupos(config: ZAPIConfig): Promise<{ grupos: GrupoWhatsapp[]; error?: string }> {
  type Chat = { isGroup?: boolean; phone?: string; id?: string; name?: string; subject?: string }
  const ler = (lista: Chat[]): GrupoWhatsapp[] => lista
    .filter(c => c && (c.isGroup === true || String(c.phone ?? '').endsWith('-group')))
    .map(c => ({ id: String(c.phone ?? c.id ?? ''), nome: String(c.name ?? c.subject ?? c.phone ?? 'Grupo') }))
    .filter(g => g.id)
  try {
    for (const endpoint of ['groups?page=1&pageSize=200', 'chats?page=1&pageSize=300']) {
      const res = await fetch(buildUrl(config, endpoint), { headers: headers(config), cache: 'no-store' })
      if (!res.ok) continue
      const data = await res.json()
      const grupos = ler(Array.isArray(data) ? data : [])
      if (grupos.length > 0) return { grupos }
    }
    return { grupos: [] }
  } catch (e) {
    return { grupos: [], error: e instanceof Error ? e.message : String(e) }
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

/** GET de leitura que devolve JSON (dados de contato e de conversa). */
async function zapiLer(config: ZAPIConfig, endpoint: string): Promise<{ ok: true; dados: Record<string, unknown> } | { ok: false; status: number | null; error: string }> {
  try {
    const res = await fetch(buildUrl(config, endpoint), { headers: headers(config), cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` }
    const dados = await res.json().catch(() => null)
    return dados && typeof dados === 'object' && !Array.isArray(dados) ? { ok: true, dados } : { ok: false, status: res.status, error: 'resposta vazia' }
  } catch (e: unknown) {
    return { ok: false, status: null, error: e instanceof Error ? e.message : 'sem resposta' }
  }
}

/** Dados da conversa (GET /chats/{phone}): `name` é o nome que aparece na lista de conversas. Só leitura. */
export const zapiConversaMetadata = (config: ZAPIConfig, phone: string) => zapiLer(config, `chats/${cleanPhone(phone)}`)

/**
 * Dados do contato (GET /contacts/{phone}): `notify` é o nome que a pessoa
 * colocou no WhatsApp ("~Leilane" na tela do celular); `name`/`short`/`vname`
 * só vêm quando o número está salvo na agenda do aparelho. Só leitura.
 */
export const zapiContatoMetadata = (config: ZAPIConfig, phone: string) => zapiLer(config, `contacts/${cleanPhone(phone)}`)

/**
 * Link da foto do perfil (GET /profile-picture). Aceita número ou código
 * oculto ("…@lid"). O link é do WhatsApp e vence em alguns dias. Só leitura.
 */
export async function zapiFotoPerfil(config: ZAPIConfig, phone: string): Promise<{ ok: true; link: string | null } | { ok: false; error: string }> {
  try {
    const alvo = /@lid$/i.test(phone) ? phone.trim() : phone.replace(/\D/g, '')
    const res = await fetch(buildUrl(config, `profile-picture?phone=${encodeURIComponent(alvo)}`), {
      headers: headers(config), cache: 'no-store', signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const dados = await res.json().catch(() => null)
    const item = Array.isArray(dados) ? dados[0] : dados
    const link = item && typeof item.link === 'string' && /^https:\/\//i.test(item.link) ? item.link : null
    return { ok: true, link }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'sem resposta' }
  }
}
