import sharp from 'sharp'

// IMAGEM DO KIT — as fotos reais dos componentes, juntas num quadrado de
// fundo branco.
//
// Montagem e não IA de propósito: gerar uma foto "nova" do kit pode mudar
// cor, formato ou marca do produto, e no anúncio isso vira reclamação de
// "produto diferente da foto". Juntar as fotos que já existem é fiel,
// instantâneo e não custa nada por imagem.
//
// Fundo branco e sem cortar nada (fit: contain) pelo mesmo motivo do ajuste
// de imagem para marketplace (api/produtos/imagens/ajustar): é o que o
// Mercado Livre e a Shopee pedem. O selo de quantidade ("2x") é opcional e
// vem desligado — o Mercado Livre não aceita texto na foto principal.

import { LADO_PADRAO, layoutDaMontagem, textoDoSelo } from './layoutKit'

export { LADO_PADRAO, MAX_COMPONENTES, layoutDaMontagem, textoDoSelo } from './layoutKit'

function svgDoSelo(texto: string, ladoCelula: number): Buffer {
  const d = Math.max(56, Math.round(ladoCelula * 0.2))
  const fonte = Math.round(d * (texto.length > 3 ? 0.32 : 0.42))
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">` +
    `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 2}" fill="#1d4ed8"/>` +
    `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" ` +
    `font-weight="700" font-size="${fonte}" fill="#ffffff">${texto}</text></svg>`,
  )
}

/**
 * Tira a sobra de fundo em volta do produto, para ele ocupar a célula em vez
 * de ficar pequeno no meio de uma margem branca. Foto sem sobra (ou de cor
 * única) volta como está.
 */
async function semSobra(imagem: Buffer): Promise<Buffer> {
  const girada = await sharp(imagem).rotate().toBuffer() // orientação da foto de celular (EXIF)
  try {
    return await sharp(girada).trim({ threshold: 12 }).toBuffer()
  } catch {
    return girada
  }
}

export type ParteDaMontagem = { imagem: Buffer; quantidade: number }

/** Monta o JPEG do kit. `selo` liga o "2x" no canto das fotos com quantidade > 1. */
export async function montarImagemKit(partes: ParteDaMontagem[], opcoes: { selo: boolean; lado?: number }): Promise<Buffer> {
  const lado = opcoes.lado ?? LADO_PADRAO
  const celulas = layoutDaMontagem(partes.length, lado)
  const camadas: sharp.OverlayOptions[] = []

  for (let i = 0; i < partes.length; i++) {
    const c = celulas[i]
    const foto = await sharp(await semSobra(partes[i].imagem))
      .resize(c.lado, c.lado, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer()
    camadas.push({ input: foto, left: c.x, top: c.y })

    const selo = opcoes.selo ? textoDoSelo(partes[i].quantidade) : null
    if (selo) {
      const svg = svgDoSelo(selo, c.lado)
      const d = (await sharp(svg).metadata()).width ?? 0
      const folga = Math.round(c.lado * 0.03)
      camadas.push({ input: svg, left: c.x + c.lado - d - folga, top: c.y + folga })
    }
  }

  return sharp({ create: { width: lado, height: lado, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(camadas)
    .jpeg({ quality: 90 })
    .toBuffer()
}
