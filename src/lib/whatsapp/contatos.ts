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
  text?: { message?: unknown }; message?: { text?: unknown }
  image?: { imageUrl?: unknown; caption?: unknown }
}

/**
 * Número de quem escreveu, se a mensagem é conversa com a loja. Grupo, canal,
 * lista de transmissão, mensagem do próprio número e id que não é telefone
 * (grupo "1203...-1234", "@lid", "status@broadcast") ficam de fora.
 */
export function telefoneDoRemetente(body: Recebida): string | null {
  if (body.fromMe || body.isGroup || body.isNewsletter || body.broadcast) return null
  const bruto = String(body.phone ?? body.from ?? '')
  if (!bruto || /[-@]/.test(bruto.replace('@s.whatsapp.net', ''))) return null
  const d = bruto.replace('@s.whatsapp.net', '').replace(/\D/g, '')
  return d.length >= 10 && d.length <= 13 ? d : null
}

/** Nome que a pessoa usa no WhatsApp (pode não existir). */
export function nomeDoRemetente(body: Recebida): string | null {
  const nome = [body.senderName, body.chatName].find(v => typeof v === 'string' && v.trim())
  return nome ? String(nome).trim().slice(0, 80) : null
}

/** Texto para o histórico: mensagem, ou "[foto] legenda", ou "[mídia]". */
export function textoDaMensagem(body: Recebida): string {
  const texto = body.text?.message ?? body.message?.text
  if (typeof texto === 'string' && texto.trim()) return texto
  if (body.image?.imageUrl) {
    const legenda = typeof body.image.caption === 'string' ? body.image.caption : ''
    return `[foto]${legenda ? ` ${legenda}` : ''}`
  }
  return '[mídia]'
}
