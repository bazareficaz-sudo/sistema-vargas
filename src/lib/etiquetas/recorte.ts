// Onde está a etiqueta dentro da página do PDF.
//
// O Mercado Livre devolve a etiqueta numa folha grande (A4), ocupando só um
// pedaço dela. Encaixar a folha inteira na metade da etiqueta deixava a
// etiqueta minúscula (medido no primeiro teste real, 02/10/2026). Aqui o
// pdf.js lê os comandos de desenho de cada página — texto, imagens (código
// de barras, QR) e traços — e devolve o retângulo que eles ocupam. Quem
// monta a folha recorta por ele: o recorte é vetorial, o código de barras
// continua nítido.
//
// Não desenha nada (sem canvas): só percorre a lista de operações, seguindo
// a matriz de transformação, e soma as caixas.

type Caixa = { left: number; bottom: number; right: number; top: number }
type Matriz = [number, number, number, number, number, number]

function mult(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ]
}
function ponto(m: Matriz, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export async function areasDeConteudo(pdf: Uint8Array): Promise<(Caixa | null)[]> {
  // O worker é carregado aqui, explicitamente, e entregue ao pdf.js pelo
  // globalThis.pdfjsWorker — no servidor ele roda no mesmo processo. Sem
  // isso o pdf.js procura o arquivo por caminho relativo, que pode não ir
  // junto no pacote da função em produção.
  const g = globalThis as any
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const OPS = pdfjs.OPS
  const doc = await pdfjs.getDocument({
    data: pdf.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
  }).promise

  const caixas: (Caixa | null)[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const [px0, py0, px1, py1] = page.view as number[]
    const areaPagina = (px1 - px0) * (py1 - py0)
    let cx: Caixa | null = null
    const somar = (pts: [number, number][]) => {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      const c = { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) }
      if (!Number.isFinite(c.left) || !Number.isFinite(c.top)) return
      // Fundo ou moldura da página inteira não é "conteúdo": ignora.
      if ((c.right - c.left) * (c.top - c.bottom) > areaPagina * 0.9) return
      cx = cx
        ? { left: Math.min(cx.left, c.left), bottom: Math.min(cx.bottom, c.bottom), right: Math.max(cx.right, c.right), top: Math.max(cx.top, c.top) }
        : c
    }

    const lista = await page.getOperatorList()
    let ctm: Matriz = [1, 0, 0, 1, 0, 0]
    const pilha: Matriz[] = []
    for (let i = 0; i < lista.fnArray.length; i++) {
      const fn = lista.fnArray[i]
      const args = lista.argsArray[i]
      if (fn === OPS.save) pilha.push(ctm)
      else if (fn === OPS.restore) ctm = pilha.pop() ?? ctm
      else if (fn === OPS.transform) ctm = mult(args as Matriz, ctm)
      else if (fn === OPS.paintFormXObjectBegin) {
        pilha.push(ctm)
        if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mult(args[0] as Matriz, ctm)
      } else if (fn === OPS.paintFormXObjectEnd) ctm = pilha.pop() ?? ctm
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject
        || fn === OPS.paintImageMaskXObject || fn === OPS.paintSolidColorImageMask) {
        somar([ponto(ctm, 0, 0), ponto(ctm, 1, 0), ponto(ctm, 0, 1), ponto(ctm, 1, 1)])
      } else if (fn === OPS.constructPath) {
        // args[2] = [minX, minY, maxX, maxY] do traçado, no espaço atual.
        const mm = args?.[2]
        if (Array.isArray(mm) && mm.length === 4 && mm.every((v: any) => Number.isFinite(v))) {
          somar([ponto(ctm, mm[0], mm[1]), ponto(ctm, mm[2], mm[1]), ponto(ctm, mm[0], mm[3]), ponto(ctm, mm[2], mm[3])])
        }
      }
    }

    // Texto: o transform de cada item já está no espaço da página.
    const texto = await page.getTextContent()
    for (const it of texto.items as any[]) {
      if (!it?.str?.trim() || !Array.isArray(it.transform)) continue
      const [, , , d, e, f] = it.transform
      const h = Math.abs(it.height || d || 0)
      somar([[e, f - h * 0.25], [e + (it.width || 0), f + h]])
    }

    caixas.push(cx)
    page.cleanup()
  }
  await doc.destroy()
  return caixas
}
