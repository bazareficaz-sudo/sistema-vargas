// Parte sem sharp da imagem do kit (ver montagemKit.ts): pode ser usada na
// tela sem levar o processador de imagem do servidor para o navegador.

export const LADO_PADRAO = 1200
/** Acima disso as fotos ficam pequenas demais para dizer alguma coisa. */
export const MAX_COMPONENTES = 9

export type Celula = { x: number; y: number; lado: number }

/**
 * Onde cada foto fica no quadrado. Cada célula é quadrada (as fotos são
 * enquadradas com fundo branco dentro dela).
 *   1 → ocupa tudo · 2 → lado a lado, centradas na altura
 *   3 → 2 em cima e 1 embaixo, centrada · 4 → 2×2
 *   5 a 6 → 3 colunas · 7 a 9 → 3×3
 * Linhas incompletas ficam centradas, e o conjunto fica centrado na altura.
 */
export function layoutDaMontagem(n: number, lado = LADO_PADRAO): Celula[] {
  if (n <= 0) return []
  const margem = Math.round(lado * 0.04)
  const espaco = Math.round(lado * 0.03)
  const util = lado - 2 * margem
  const colunas = n === 1 ? 1 : n <= 4 ? 2 : 3
  const linhas = Math.ceil(n / colunas)
  const celula = Math.floor((util - espaco * (colunas - 1)) / colunas)
  const alturaTotal = linhas * celula + (linhas - 1) * espaco
  const topo = Math.round((lado - alturaTotal) / 2)

  const out: Celula[] = []
  for (let i = 0; i < n; i++) {
    const linha = Math.floor(i / colunas)
    const naLinha = Math.min(colunas, n - linha * colunas)
    const larguraLinha = naLinha * celula + (naLinha - 1) * espaco
    const inicio = Math.round((lado - larguraLinha) / 2)
    const col = i - linha * colunas
    out.push({ x: inicio + col * (celula + espaco), y: topo + linha * (celula + espaco), lado: celula })
  }
  return out
}

/** "2x", "1,5x" — só quando a quantidade é maior que 1. */
export function textoDoSelo(quantidade: number): string | null {
  if (!(quantidade > 1)) return null
  const q = Number.isInteger(quantidade) ? String(quantidade) : quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return `${q}x`
}
