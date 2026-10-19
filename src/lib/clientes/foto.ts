// Foto do cliente no cadastro (migração 20261021120000_cliente_foto.sql):
// bucket privado clientes-fotos, caminho <empresa>/<cliente>/<arquivo>.
// Vem da tela (enviada) ou da foto do perfil do WhatsApp — o link do
// WhatsApp vence, então a imagem é copiada para o bucket.

export const BUCKET_FOTOS = 'clientes-fotos'
export const LIMITE_FOTO = 5 * 1024 * 1024
export const TIPOS_FOTO: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Caminho novo da foto (nome único: a foto antiga é apagada depois). */
export function caminhoDaFoto(empresaId: string, clienteId: string, tipo: string, id: string = crypto.randomUUID()): string | null {
  const ext = TIPOS_FOTO[tipo.split(';')[0].trim().toLowerCase()]
  return ext ? `${empresaId}/${clienteId}/${id}.${ext}` : null
}

/** A foto é deste cliente? (o banco confere de novo com CHECK). */
export const fotoDoCliente = (caminho: string | null | undefined, empresaId: string, clienteId: string) =>
  Boolean(caminho && caminho.startsWith(`${empresaId}/${clienteId}/`))

/** Só baixa de onde o WhatsApp/Z-API serve fotos (o servidor não busca link qualquer). */
export function linkDoWhatsapp(link: string | null | undefined): boolean {
  try {
    const u = new URL(String(link ?? ''))
    return u.protocol === 'https:' && /(^|\.)(whatsapp\.net|whatsapp\.com|z-api\.io)$/i.test(u.hostname)
  } catch { return false }
}

type Sb = { from: (t: string) => any; storage: { from: (b: string) => any } } // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Baixa a foto do perfil do WhatsApp (link https da Z-API) e grava no
 * cadastro. Não troca foto enviada pela tela, a menos que `substituir`.
 */
export async function copiarFotoDoWhatsapp(sb: Sb, empresaId: string, clienteId: string, link: string, substituir = false):
  Promise<{ ok: true; caminho: string } | { ok: false; motivo: string }> {
  if (!linkDoWhatsapp(link)) return { ok: false, motivo: 'Link da foto inválido.' }
  const { data: cli } = await sb.from('clientes').select('id, foto_path, foto_origem').eq('empresa_id', empresaId).eq('id', clienteId).maybeSingle()
  if (!cli) return { ok: false, motivo: 'Cliente não encontrado.' }
  if (cli.foto_path && cli.foto_origem === 'manual' && !substituir) return { ok: false, motivo: 'O cliente já tem foto enviada pela loja.' }

  let res: Response
  try {
    res = await fetch(link, { cache: 'no-store', signal: AbortSignal.timeout(10_000), redirect: 'error' })
  } catch { return { ok: false, motivo: 'O WhatsApp não entregou a foto.' } }
  const tipo = res.headers.get('content-type') ?? ''
  const tamanho = Number(res.headers.get('content-length') ?? 0)
  if (!res.ok) return { ok: false, motivo: 'A foto do WhatsApp venceu ou não está disponível.' }
  const caminho = caminhoDaFoto(empresaId, clienteId, tipo)
  if (!caminho) return { ok: false, motivo: 'O WhatsApp mandou um arquivo que não é foto.' }
  if (tamanho > LIMITE_FOTO) return { ok: false, motivo: 'Foto grande demais.' }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > LIMITE_FOTO) return { ok: false, motivo: 'Foto vazia ou grande demais.' }

  const { error: erroEnvio } = await sb.storage.from(BUCKET_FOTOS).upload(caminho, bytes, { contentType: tipo.split(';')[0] })
  if (erroEnvio) return { ok: false, motivo: 'Não foi possível guardar a foto.' }
  const { error } = await sb.from('clientes')
    .update({ foto_path: caminho, foto_origem: 'whatsapp', foto_em: new Date().toISOString() })
    .eq('empresa_id', empresaId).eq('id', clienteId)
  if (error) { await sb.storage.from(BUCKET_FOTOS).remove([caminho]); return { ok: false, motivo: 'Não foi possível gravar no cadastro.' } }
  if (cli.foto_path && cli.foto_path !== caminho) await sb.storage.from(BUCKET_FOTOS).remove([cli.foto_path])
  return { ok: true, caminho }
}

/** Links assinados (1 h) das fotos, por caminho. */
export async function linksDasFotos(sb: Sb, caminhos: (string | null | undefined)[]): Promise<Map<string, string>> {
  const lista = [...new Set(caminhos.filter((c): c is string => Boolean(c)))]
  const mapa = new Map<string, string>()
  if (!lista.length) return mapa
  const { data } = await sb.storage.from(BUCKET_FOTOS).createSignedUrls(lista, 3600)
  for (const a of (data ?? []) as { path: string | null; signedUrl: string | null }[]) if (a.path && a.signedUrl) mapa.set(a.path, a.signedUrl)
  return mapa
}

/** Só copia se o cliente ainda não tem foto (uso automático: conversa e webhook). */
export async function copiarSeSemFoto(sb: Sb, empresaId: string, clienteId: string, link: string | null | undefined): Promise<void> {
  if (!link || !linkDoWhatsapp(link)) return
  const { data: cli } = await sb.from('clientes').select('foto_path').eq('empresa_id', empresaId).eq('id', clienteId).maybeSingle()
  if (cli && !cli.foto_path) await copiarFotoDoWhatsapp(sb, empresaId, clienteId, link)
}
