// Envio de e-mail pelo Resend (resend.com), direto na API — sem biblioteca.
//
// Configuração na Vercel (Settings › Environment Variables):
//   RESEND_API_KEY   chave "re_..." do Resend, com permissão de envio
//   EMAIL_REMETENTE  ex.: "Sistema Vargas <fechamento@sistemavargas.com.br>"
// O domínio do remetente precisa estar verificado no Resend.

export type AnexoEmail = { nome: string; conteudo: Uint8Array | Buffer }

export type EmailParaEnviar = {
  para: string[]
  copia?: string[]
  responderPara?: string | null
  assunto: string
  html: string
  texto: string
  anexos?: AnexoEmail[]
}

export type ResultadoEmail = { ok: true; id: string | null } | { ok: false; erro: string }

const EMAIL_VALIDO = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/

/** "a@x.com; b@y.com" → ['a@x.com', 'b@y.com'], descartando o que não é e-mail. */
export function listaDeEmails(texto: string | null | undefined): string[] {
  return Array.from(new Set(String(texto ?? '').split(/[;,\s]+/).map(s => s.trim().toLowerCase()).filter(s => EMAIL_VALIDO.test(s))))
}

export function emailConfigurado(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_REMETENTE
}

export async function enviarEmail(e: EmailParaEnviar): Promise<ResultadoEmail> {
  const chave = process.env.RESEND_API_KEY
  const de = process.env.EMAIL_REMETENTE
  if (!chave || !de) return { ok: false, erro: 'Envio de e-mail não configurado (RESEND_API_KEY e EMAIL_REMETENTE na Vercel).' }
  if (e.para.length === 0) return { ok: false, erro: 'Nenhum destinatário válido.' }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: de,
        to: e.para,
        ...(e.copia?.length ? { cc: e.copia } : {}),
        ...(e.responderPara ? { reply_to: e.responderPara } : {}),
        subject: e.assunto,
        html: e.html,
        text: e.texto,
        ...(e.anexos?.length ? {
          attachments: e.anexos.map(a => ({ filename: a.nome, content: Buffer.from(a.conteudo).toString('base64') })),
        } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    })
    const d = await r.json().catch(() => ({})) as { id?: string; message?: string; name?: string }
    if (!r.ok) return { ok: false, erro: d.message ?? `Resend respondeu ${r.status}` }
    return { ok: true, id: d.id ?? null }
  } catch (err) {
    return { ok: false, erro: `Falha ao falar com o serviço de e-mail: ${(err as Error).message}` }
  }
}
