// Contatos do WhatsApp: quem manda mensagem para a loja vira pré-cadastro
// (tabela whatsapp_contatos, migração 20261015120000_whatsapp_contatos.sql).
// Aqui fica só o que não depende do banco: o que conta como conversa de
// cliente e a chave do telefone — a mesma regra da função SQL tel_chave().

/** Dígitos sem o 55 e sem o 0 de discagem; DDD + 8 últimos dígitos. Nulo sem DDD. */
export function chaveTelefone(v: string | null | undefined): string | null {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  else if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  if (d.length !== 10 && d.length !== 11) return null
  return d.slice(0, 2) + d.slice(-8)
}

type Recebida = {
  fromMe?: boolean; isGroup?: boolean; isNewsletter?: boolean; broadcast?: boolean
  phone?: unknown; from?: unknown; chatName?: unknown; senderName?: unknown
  chatLid?: unknown; senderLid?: unknown; photo?: unknown; senderPhoto?: unknown
  text?: { message?: unknown }; message?: { text?: unknown }
  image?: { imageUrl?: unknown; caption?: unknown }
  audio?: { audioUrl?: unknown }
  video?: { videoUrl?: unknown; caption?: unknown }
  document?: { documentUrl?: unknown; fileName?: unknown; title?: unknown; caption?: unknown }
  sticker?: { stickerUrl?: unknown }
  messageId?: unknown; referenceMessageId?: unknown
}

/**
 * Identificação de quem escreveu, se a mensagem é conversa com a loja.
 * Grupo, canal, lista de transmissão, mensagem do próprio número e
 * "status@broadcast" ficam de fora.
 *
 * "@lid": o WhatsApp esconde o número de parte das pessoas e manda só um
 * código (medido em 15/10/2026: 22 de 99 contatos). É gente de verdade
 * procurando a loja — vira contato com o código, sem telefone conhecido.
 */
export function telefoneDoRemetente(body: Recebida): string | null {
  if (body.fromMe || body.isGroup || body.isNewsletter || body.broadcast) return null
  const bruto = String(body.phone ?? body.from ?? '').replace('@s.whatsapp.net', '')
  if (!bruto || bruto.includes('-') || bruto.includes('broadcast')) return null
  if (bruto.includes('@') && !bruto.endsWith('@lid')) return null
  const d = bruto.replace(/\D/g, '')
  if (bruto.endsWith('@lid')) return d.length >= 8 ? d : null
  return d.length >= 10 && d.length <= 13 ? d : null
}

/** Número escondido pelo WhatsApp (código "@lid") ou fora do padrão brasileiro: sem wa.me nem telefone no cadastro. */
export const numeroOculto = (telefone: string) => chaveTelefone(telefone) === null

/**
 * Nome que a pessoa usa no WhatsApp (pode não existir). O código oculto
 * ("7674…@lid") e número no lugar do nome não contam — viravam o "nome" do
 * contato na lista.
 */
export function nomeDoRemetente(body: Recebida): string | null {
  const nome = [body.senderName, body.chatName]
    .find(v => typeof v === 'string' && v.trim() && !/@lid$/i.test(v.trim()) && !/^[+\d\s()-]+$/.test(v.trim()))
  return nome ? String(nome).trim().slice(0, 80) : null
}

/**
 * Código oculto ("@lid") da PESSOA da conversa, só os dígitos. A Z-API manda
 * em `chatLid` — junto do número quando sabe os dois (é assim que o código
 * fica ligado ao número). `senderLid` só vale na mensagem DO CLIENTE: na
 * enviada pela loja, é o código da própria loja.
 */
export function lidDaMensagem(body: Recebida): string | null {
  const candidatos = [body.chatLid, body.fromMe ? null : body.senderLid, body.phone]
  for (const v of candidatos) {
    if (typeof v !== 'string' || !/@lid$/i.test(v.trim())) continue
    const d = v.replace(/\D/g, '')
    if (d.length >= 8) return d
  }
  return null
}

/** Foto do perfil da pessoa (link do WhatsApp, temporário). Na mensagem da loja, `senderPhoto` é a da loja. */
export function fotoDaMensagem(body: Recebida): string | null {
  for (const v of [body.photo, body.fromMe ? null : body.senderPhoto]) {
    if (typeof v === 'string' && /^https:\/\//i.test(v.trim())) return v.trim().slice(0, 1000)
  }
  return null
}

/**
 * Nome do contato na resposta de dados do contato da Z-API: o que a pessoa
 * colocou no WhatsApp (`notify`) primeiro; senão o da agenda do aparelho.
 * Número no lugar do nome (contato sem nome) não conta.
 */
export function nomeDoMetadata(dados: Record<string, unknown> | null | undefined): string | null {
  for (const campo of ['notify', 'pushname', 'pushName', 'name', 'short', 'vname']) {
    const v = dados?.[campo]
    if (typeof v !== 'string') continue
    const nome = v.replace(/^~\s*/, '').trim()
    if (nome && !/^[+\d\s()-]+$/.test(nome)) return nome.slice(0, 80)
  }
  return null
}

/** Campos com texto na resposta (só os nomes dos campos, para diagnóstico — nunca os valores). */
export function camposComTexto(dados: Record<string, unknown> | null | undefined): string[] {
  return Object.entries(dados ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k]) => k).sort()
}

export type TipoMidia = 'foto' | 'audio' | 'video' | 'documento' | 'figurinha'
const MARCA: Record<TipoMidia, string> = { foto: '[foto]', audio: '[áudio]', video: '[vídeo]', documento: '[documento]', figurinha: '[figurinha]' }
const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const link = (v: unknown) => (typeof v === 'string' && /^https:\/\//i.test(v.trim()) ? v.trim() : null)

/** Arquivo que veio na mensagem (link da Z-API, temporário) e o seu tipo. */
export function midiaDaMensagem(body: Recebida): { tipo: TipoMidia; url: string; legenda: string } | null {
  const opcoes: [TipoMidia, unknown, unknown][] = [
    ['foto', body.image?.imageUrl, body.image?.caption],
    ['audio', body.audio?.audioUrl, ''],
    ['video', body.video?.videoUrl, body.video?.caption],
    ['documento', body.document?.documentUrl, body.document?.caption || body.document?.fileName || body.document?.title],
    ['figurinha', body.sticker?.stickerUrl, ''],
  ]
  for (const [tipo, url, legenda] of opcoes) {
    const u = link(url)
    if (u) return { tipo, url: u, legenda: txt(legenda) }
  }
  return null
}

/** Texto para o histórico: mensagem, ou "[foto] legenda", "[áudio]"… ou "[mídia]". */
export function textoDaMensagem(body: Recebida): string {
  const texto = body.text?.message ?? body.message?.text
  if (typeof texto === 'string' && texto.trim()) return texto
  const m = midiaDaMensagem(body)
  if (m) return `${MARCA[m.tipo]}${m.legenda ? ` ${m.legenda}` : ''}`
  return '[mídia]'
}

/** Tipo do arquivo pela marca do texto ("[foto] …") — é o que a tela usa para mostrar. */
export function tipoPelaMarca(conteudo: string): TipoMidia | null {
  for (const [tipo, marca] of Object.entries(MARCA) as [TipoMidia, string][]) {
    if (conteudo === marca || conteudo.startsWith(`${marca} `)) return tipo
  }
  return null
}

/** Texto sem a marca do arquivo (o arquivo já aparece na tela). */
export function semMarca(conteudo: string): string {
  const tipo = tipoPelaMarca(conteudo)
  return tipo ? conteudo.slice(MARCA[tipo].length).trim() : conteudo
}

/** Id de mensagem do WhatsApp com formato aceitável (ou nulo). */
export const idValido = (v: unknown) => (typeof v === 'string' && /^[\w:.@-]{6,128}$/.test(v.trim()) ? v.trim() : null)

/** Id (WhatsApp) desta mensagem. */
export const idDaMensagem = (body: Recebida) => idValido(body.messageId)

/** Id da mensagem que esta responde, quando a pessoa usou "Responder". */
export const respostaDe = (body: Recebida) => idValido(body.referenceMessageId)

/**
 * Número para começar conversa: só dígitos com 55 + DDD (10 ou 11 dígitos
 * depois do 55). Aceita máscara, 0 de discagem e o 55 já digitado. Nulo se
 * não der para entender o DDD — mesma regra da função whatsapp_abrir_conversa.
 */
export function telefoneParaWhatsapp(v: string | null | undefined): string | null {
  const bruto = String(v ?? '').trim()
  let d = bruto.replace(/\D/g, '')
  // "+" na frente é código de país: só o 55 serve (+1 415… não é DDD 14).
  if (bruto.startsWith('+') && !d.startsWith('55')) return null
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10 || d.length === 11) d = `55${d}`
  if ((d.length !== 12 && d.length !== 13) || !d.startsWith('55')) return null
  return chaveTelefone(d) ? d : null
}

/**
 * Qual conversa fica ao juntar duas: a com número recebe a só do código.
 * Duas com número: não junta (nulo). Duas só com código: a segunda recebe.
 */
export function destinoDaJuncao(a: { id: string; telefone: string }, b: { id: string; telefone: string }): { de: string; para: string } | null {
  const ocultoA = numeroOculto(a.telefone), ocultoB = numeroOculto(b.telefone)
  if (!ocultoA && !ocultoB) return null
  if (ocultoA) return { de: a.id, para: b.id }
  return { de: b.id, para: a.id }
}
