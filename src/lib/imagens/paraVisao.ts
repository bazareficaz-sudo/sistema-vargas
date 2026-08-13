import sharp from 'sharp'

// Preparo de imagem para a IA olhar.
//
// Por que baixar em vez de mandar o endereço: a API da Anthropic aceita imagem
// por URL, mas quem baixa nesse caso é ela — e a CDN do Mercado Livre recusa
// esse download ("Unable to download the file"). Medido: com endereço direto a
// chamada falha inteira. Baixando aqui, funciona.
//
// A imagem também é reduzida antes de subir. O custo de visão cresce com a
// quantidade de pixels, e para achar marca d'água, logotipo ou telefone
// escrito na foto, 1024px de lado maior é mais do que suficiente.

const LADO_MAXIMO = 1024
const TIMEOUT_MS = 15_000

export type ImagemParaVisao = { base64: string; mediaType: string }

/**
 * Baixa e normaliza uma imagem. Devolve null quando não dá para usar — fora
 * do ar, formato que o sharp não entende, arquivo que não é imagem. Null é
 * resposta legítima aqui: uma foto quebrada não pode derrubar a conferência
 * das outras nove.
 */
export async function baixarParaVisao(url: string): Promise<ImagemParaVisao | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Sem User-Agent, algumas CDNs devolvem 403 para chamada de servidor.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SistemaVargas/1.0)' },
    })
    if (!resp.ok) return null

    const original = Buffer.from(await resp.arrayBuffer())
    // JPEG sempre: é o formato mais barato em bytes para foto, e a
    // transparência não interessa para conferência visual.
    const buffer = await sharp(original)
      .flatten({ background: '#ffffff' })
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()

    return { base64: buffer.toString('base64'), mediaType: 'image/jpeg' }
  } catch {
    return null
  }
}
