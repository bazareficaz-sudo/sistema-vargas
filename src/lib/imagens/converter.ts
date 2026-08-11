import sharp from 'sharp'

// Conversão de imagem para o formato que o marketplace aceita.
//
// A Shopee recusa WebP com "image is invalid or not supported". O upload já
// mandava o arquivo com o nome "produto.jpg", mas o nome não muda os bytes —
// o marketplace lê o conteúdo. Aqui os bytes são realmente convertidos.
//
// Por que WebP aparece: fotos salvas do navegador, imagens importadas por URL
// de sites que servem WebP, e celulares mais novos. Não é caso raro.

/** Formatos que a Shopee aceita no media_space. */
export const FORMATOS_SHOPEE = ['jpeg', 'jpg', 'png'] as const

export type ResultadoConversao = {
  buffer: Buffer
  /** Tipo final, já convertido. */
  contentType: string
  nomeArquivo: string
  /** Formato de origem, quando foi possível detectar. */
  formatoOriginal: string | null
  convertida: boolean
}

// Teto da Shopee por imagem. Convertida com qualidade alta, uma foto de
// celular passa disso com facilidade — por isso a redimensão abaixo.
const LIMITE_BYTES = 5 * 1024 * 1024
// Maior dimensão aceita sem perda de nitidez visível num anúncio.
const LADO_MAXIMO = 1600

/**
 * Garante que os bytes estejam num formato aceito pelo marketplace.
 *
 * Converte quando o formato não é aceito e, se ainda assim o arquivo passar
 * do limite, reduz o lado maior e baixa a qualidade — nessa ordem, porque
 * reduzir dimensão preserva mais aparência do que só espremer a qualidade.
 */
export async function garantirFormatoAceito(
  entrada: ArrayBuffer | Buffer,
  formatosAceitos: readonly string[] = FORMATOS_SHOPEE,
): Promise<ResultadoConversao> {
  const buffer = Buffer.isBuffer(entrada) ? entrada : Buffer.from(entrada)

  let meta: sharp.Metadata
  try {
    meta = await sharp(buffer).metadata()
  } catch {
    // Não é imagem que o sharp entenda (SVG mal formado, arquivo corrompido).
    // Devolve como está: quem chamou decide, e o erro do marketplace fica
    // sendo a resposta honesta em vez de um erro inventado aqui.
    return {
      buffer, contentType: 'application/octet-stream',
      nomeArquivo: 'produto.bin', formatoOriginal: null, convertida: false,
    }
  }

  const formato = meta.format ?? null
  const jaAceito = formato != null && formatosAceitos.includes(formato)
  const dentroDoLimite = buffer.byteLength <= LIMITE_BYTES

  if (jaAceito && dentroDoLimite) {
    return {
      buffer,
      contentType: formato === 'png' ? 'image/png' : 'image/jpeg',
      nomeArquivo: formato === 'png' ? 'produto.png' : 'produto.jpg',
      formatoOriginal: formato, convertida: false,
    }
  }

  // JPEG e não PNG: PNG de foto fica grande demais e a Shopee não precisa de
  // transparência num anúncio. Fundo branco resolve o alfa do WebP/PNG, que
  // viraria preto se fosse simplesmente descartado.
  let pipeline = sharp(buffer).flatten({ background: '#ffffff' })

  const maiorLado = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (maiorLado > LADO_MAXIMO) {
    pipeline = pipeline.resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
  }

  let saida = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()

  // Ainda grande: baixa a qualidade em degraus, em vez de escolher um valor
  // baixo de cara para todo mundo.
  for (const q of [80, 70, 60]) {
    if (saida.byteLength <= LIMITE_BYTES) break
    saida = await sharp(buffer)
      .flatten({ background: '#ffffff' })
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: q, mozjpeg: true })
      .toBuffer()
  }

  return {
    buffer: saida,
    contentType: 'image/jpeg',
    nomeArquivo: 'produto.jpg',
    formatoOriginal: formato,
    convertida: true,
  }
}
