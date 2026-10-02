// Monta o PDF de impressão das etiquetas de envio, em papel térmico 100×150.
//
//   'original' → a etiqueta do marketplace como veio, uma por folha em pé
//                (4×6 pol.), ajustada ao papel.
//   'paisagem' → a folha deitada (6×4 pol.) e dividida ao meio: à esquerda a
//                etiqueta do marketplace reduzida, à direita o MINI PEDIDO —
//                número interno, canal, comprador e a lista de itens com
//                quadradinho para conferir. É a conferência de quem não tem
//                uma equipe de separação: embala olhando a própria etiqueta.
//
// Cada página do PDF do marketplace vira uma etiqueta (pedido com mais de
// um volume pode vir com mais de uma). O PDF original é embutido como
// vetor, sem virar imagem — o código de barras continua nítido reduzido.

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type PDFEmbeddedPage } from 'pdf-lib'
import { areasDeConteudo } from './recorte'

export type FormatoEtiqueta = 'original' | 'paisagem'

export type PedidoNaFolha = {
  pv: string
  canal: string
  numeroMarketplace: string
  comprador: string
  cidade: string
  prazo: string | null
  nf: string | null
  observacao: string | null
  itens: { nome: string; sku: string | null; quantidade: number }[]
}

const POL = 72 // pontos por polegada
const RETRATO = { w: 4 * POL, h: 6 * POL }
const PAISAGEM = { w: 6 * POL, h: 4 * POL }
const PRETO = rgb(0, 0, 0)
const CINZA = rgb(0.35, 0.35, 0.35)

// As fontes padrão do PDF só desenham o conjunto WinAnsi (Latin-1, que
// cobre os acentos do português). Fora dele, troca por equivalente ou "?"
// em vez de deixar a montagem inteira falhar por um caractere.
function limpar(texto: string): string {
  return String(texto ?? '')
    .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, '...').replace(/\s+/g, ' ')
    .split('').map(c => (c.charCodeAt(0) <= 0xff ? c : '?')).join('').trim()
}

function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number, maxLinhas: number): string[] {
  const palavras = limpar(texto).split(' ')
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    const teste = atual ? `${atual} ${p}` : p
    if (fonte.widthOfTextAtSize(teste, tamanho) <= largura) { atual = teste; continue }
    if (atual) linhas.push(atual)
    atual = p
    if (linhas.length >= maxLinhas) break
  }
  if (atual && linhas.length < maxLinhas) linhas.push(atual)
  if (linhas.length === maxLinhas && palavras.join(' ').length > linhas.join(' ').length) {
    let ultima = linhas[maxLinhas - 1]
    while (ultima && fonte.widthOfTextAtSize(`${ultima}...`, tamanho) > largura) ultima = ultima.slice(0, -1)
    linhas[maxLinhas - 1] = `${ultima}...`
  }
  return linhas
}

// Encaixa a etiqueta na área, girando 90° quando isso a deixa maior (uma
// etiqueta deitada numa área em pé, ou o contrário).
function encaixar(page: PDFPage, emb: PDFEmbeddedPage, x: number, y: number, w: number, h: number) {
  const normal = Math.min(w / emb.width, h / emb.height)
  const girada = Math.min(w / emb.height, h / emb.width)
  if (girada > normal * 1.05) {
    const lw = emb.height * girada // largura ocupada depois de girar
    const lh = emb.width * girada
    page.drawPage(emb, {
      x: x + (w - lw) / 2 + lw, y: y + (h - lh) / 2,
      width: emb.width * girada, height: emb.height * girada, rotate: degrees(90),
    })
    return
  }
  const lw = emb.width * normal
  const lh = emb.height * normal
  page.drawPage(emb, { x: x + (w - lw) / 2, y: y + (h - lh) / 2, width: lw, height: lh })
}

// Área 4×6 pol. (a etiqueta térmica) com folga: página maior que isso é
// folha (A4, carta) com a etiqueta num pedaço — e aí recorta.
const AREA_TERMICA = 4 * 72 * 6 * 72 * 1.25
const MARGEM_RECORTE = 4

function desenharMiniPedido(page: PDFPage, p: PedidoNaFolha, f: PDFFont, fb: PDFFont, x0: number, largura: number) {
  let y = PAISAGEM.h - 22
  const linha = (txt: string, tam: number, fonte = f, cor = PRETO) => {
    page.drawText(limpar(txt).slice(0, 80), { x: x0, y, size: tam, font: fonte, color: cor })
    y -= tam + 3
  }
  linha(p.pv, 14, fb)
  for (const l of quebrar(`${p.canal} · pedido ${p.numeroMarketplace}`, f, 7, largura, 2)) linha(l, 7, f, CINZA)
  for (const l of quebrar(`${p.comprador}${p.cidade ? ` · ${p.cidade}` : ''}`, f, 8, largura, 2)) linha(l, 8)
  y -= 2
  page.drawLine({ start: { x: x0, y: y + 4 }, end: { x: x0 + largura, y: y + 4 }, thickness: 0.6, color: CINZA })
  y -= 6
  linha('Conferência de itens', 7, fb, CINZA)

  const totalUn = p.itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0)
  const limiteY = 70 // reserva o rodapé
  let omitidos = 0
  for (const [idx, item] of p.itens.entries()) {
    const nomeLinhas = quebrar(item.nome, fb, 8, largura - 34, 2)
    const altura = nomeLinhas.length * 10 + 10
    if (y - altura < limiteY) { omitidos = p.itens.length - idx; break }
    page.drawRectangle({ x: x0, y: y - 8, width: 8, height: 8, borderColor: PRETO, borderWidth: 0.8 })
    page.drawText(`${item.quantidade}x`, { x: x0 + 12, y: y - 7, size: 9, font: fb, color: PRETO })
    let yy = y - 7
    for (const l of nomeLinhas) { page.drawText(l, { x: x0 + 34, y: yy, size: 8, font: fb, color: PRETO }); yy -= 10 }
    if (item.sku) page.drawText(limpar(`SKU ${item.sku}`), { x: x0 + 34, y: yy, size: 7, font: f, color: CINZA })
    y -= altura + 4
  }
  if (omitidos > 0) {
    page.drawText(`+ ${omitidos} item(ns) — ver o pedido no sistema`, { x: x0, y, size: 7, font: fb, color: PRETO })
  }

  let yr = 58
  page.drawLine({ start: { x: x0, y: yr + 10 }, end: { x: x0 + largura, y: yr + 10 }, thickness: 0.6, color: CINZA })
  page.drawText(limpar(`Total: ${totalUn} un.${p.prazo ? ` · postar até ${p.prazo}` : ''}`), { x: x0, y: yr, size: 7.5, font: fb, color: PRETO })
  yr -= 10
  if (p.nf) { page.drawText(limpar(p.nf), { x: x0, y: yr, size: 7, font: f, color: CINZA }); yr -= 10 }
  if (p.observacao) {
    for (const l of quebrar(`Obs.: ${p.observacao}`, f, 6.5, largura, 1)) { page.drawText(l, { x: x0, y: yr, size: 6.5, font: f, color: CINZA }); yr -= 9 }
  }
  page.drawText('Conferido por: ____________________', { x: x0, y: 10, size: 7.5, font: f, color: PRETO })
}

export async function montarFolha(
  // `paginas: 'primeira'` — o Mercado Livre manda na 2ª página a lista de
  // conteúdo do despacho, que o mini pedido já substitui.
  etiquetas: { pdf: Uint8Array; pedido: PedidoNaFolha; paginas?: 'primeira' | 'todas' }[],
  formato: FormatoEtiqueta,
): Promise<{ pdf: Uint8Array; falhas: { indice: number; erro: string }[] }> {
  const out = await PDFDocument.create()
  const f = await out.embedFont(StandardFonts.Helvetica)
  const fb = await out.embedFont(StandardFonts.HelveticaBold)

  // Uma etiqueta que não abre (PDF corrompido ou protegido) vira falha
  // daquele pedido — as outras seguem para a impressão.
  const falhas: { indice: number; erro: string }[] = []
  for (const [indice, { pdf, pedido, paginas = 'todas' }] of etiquetas.entries()) {
    const embutidas: PDFEmbeddedPage[] = []
    try {
      const origem = await PDFDocument.load(pdf, { ignoreEncryption: true })
      if (origem.isEncrypted) throw new Error('o PDF da etiqueta veio protegido')
      let caixas: Awaited<ReturnType<typeof areasDeConteudo>> = []
      try { caixas = await areasDeConteudo(pdf) } catch { /* sem recorte: usa a página inteira */ }
      const indices = paginas === 'primeira' ? [0] : origem.getPageIndices()
      for (const i of indices) {
        const pagina = origem.getPage(i)
        const { width: pw, height: ph } = pagina.getSize()
        const cx = caixas[i]
        // Recorta quando a página é uma folha grande ou o conteúdo ocupa só
        // parte dela; etiqueta que já vem no tamanho certo fica inteira.
        const recortar = !!cx && (pw * ph > AREA_TERMICA || (cx.right - cx.left) * (cx.top - cx.bottom) < pw * ph * 0.7)
        embutidas.push(recortar
          ? await out.embedPage(pagina, {
              left: Math.max(0, cx!.left - MARGEM_RECORTE), bottom: Math.max(0, cx!.bottom - MARGEM_RECORTE),
              right: Math.min(pw, cx!.right + MARGEM_RECORTE), top: Math.min(ph, cx!.top + MARGEM_RECORTE),
            })
          : await out.embedPage(pagina))
      }
    } catch (e: any) {
      falhas.push({ indice, erro: `Não foi possível montar a etiqueta: ${e?.message ?? e}` })
      continue
    }
    for (const emb of embutidas) {
      if (formato === 'original') {
        const page = out.addPage([RETRATO.w, RETRATO.h])
        encaixar(page, emb, 4, 4, RETRATO.w - 8, RETRATO.h - 8)
        continue
      }
      const page = out.addPage([PAISAGEM.w, PAISAGEM.h])
      const meio = PAISAGEM.w / 2
      encaixar(page, emb, 4, 4, meio - 8, PAISAGEM.h - 8)
      page.drawLine({ start: { x: meio, y: 6 }, end: { x: meio, y: PAISAGEM.h - 6 }, thickness: 0.5, color: CINZA, dashArray: [3, 3] })
      desenharMiniPedido(page, pedido, f, fb, meio + 8, meio - 16)
    }
  }
  return { pdf: await out.save(), falhas }
}
