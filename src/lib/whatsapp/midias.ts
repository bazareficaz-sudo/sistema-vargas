import { tipoPelaMarca, type TipoMidia } from './contatos'

// Arquivos das conversas do WhatsApp (foto, áudio, vídeo, documento).
//
// O link que a Z-API manda no webhook é temporário. Por isso o arquivo é
// copiado para o bucket PRIVADO `whatsapp-midias` (migração
// 20261016200000_whatsapp_midias.sql), na pasta da empresa; a tela mostra com
// link assinado de 1 h. Sem o bucket (migração não aplicada) ou se a cópia
// falhar, fica o link original — aparece enquanto a Z-API o mantiver.
//
// Na coluna `whatsapp_mensagens.conteudo_pdf_url` fica um link (https://…) ou
// a referência ao arquivo guardado: "storage:whatsapp-midias/<caminho>".

export const BUCKET_MIDIAS = 'whatsapp-midias'
const PREFIXO = `storage:${BUCKET_MIDIAS}/`
export const LIMITE_MIDIA = 16 * 1024 * 1024

type Admin = { from: (t: string) => any; storage: { from: (b: string) => any } } // eslint-disable-line @typescript-eslint/no-explicit-any

export const referenciaGuardada = (caminho: string) => `${PREFIXO}${caminho}`

/** Caminho no bucket, se a referência for de arquivo guardado. */
export function caminhoGuardado(ref: string | null | undefined): string | null {
  return ref?.startsWith(PREFIXO) ? ref.slice(PREFIXO.length) : null
}

const POR_TIPO: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/opus': 'opus',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'application/pdf': 'pdf',
}

/** Extensão do arquivo pelo tipo informado; senão pela do link; senão "bin". */
export function extensaoDoArquivo(contentType: string | null | undefined, url: string): string {
  const tipo = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (POR_TIPO[tipo]) return POR_TIPO[tipo]
  const doLink = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(url.split('?')[0])?.[1]?.toLowerCase()
  return doLink ?? 'bin'
}

/** Como mostrar o arquivo: pela marca do texto ("[foto]"…) ou pela extensão. */
export function comoMostrar(conteudo: string, ref: string | null | undefined): TipoMidia | null {
  if (!ref) return null
  const pelaMarca = tipoPelaMarca(conteudo)
  if (pelaMarca) return pelaMarca === 'figurinha' ? 'foto' : pelaMarca
  const ext = extensaoDoArquivo(null, ref)
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'foto'
  if (['ogg', 'oga', 'opus', 'mp3', 'm4a', 'aac'].includes(ext)) return 'audio'
  if (['mp4', '3gp', 'mov'].includes(ext)) return 'video'
  return 'documento'
}

/**
 * Copia o arquivo da Z-API para o bucket e troca a referência na mensagem.
 * Só https e até 16 MB. Qualquer falha deixa o link original (nunca apaga).
 */
export async function guardarMidia(admin: Admin, dados: { empresaId: string; contatoId: string | null; mensagemId: string; url: string }): Promise<boolean> {
  if (!/^https:\/\//i.test(dados.url)) return false
  try {
    const res = await fetch(dados.url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return false
    if (Number(res.headers.get('content-length') ?? 0) > LIMITE_MIDIA) return false
    const arquivo = await res.arrayBuffer()
    if (!arquivo.byteLength || arquivo.byteLength > LIMITE_MIDIA) return false
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    const caminho = `${dados.empresaId}/${dados.contatoId ?? 'sem-contato'}/${dados.mensagemId}.${extensaoDoArquivo(contentType, dados.url)}`
    const { error } = await admin.storage.from(BUCKET_MIDIAS).upload(caminho, arquivo, { contentType, upsert: true })
    if (error) return false
    const { error: e2 } = await admin.from('whatsapp_mensagens')
      .update({ conteudo_pdf_url: referenciaGuardada(caminho), updated_at: new Date().toISOString() })
      .eq('id', dados.mensagemId)
    return !e2
  } catch {
    return false
  }
}
