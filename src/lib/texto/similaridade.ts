// Similaridade de texto (Jaccard sobre tokens) — usado como sinal de
// confiança sempre que um match por SKU/EAN sozinho não é garantia (SKUs
// deste sistema são sequenciais, sem prefixo, então podem coincidir por
// acaso entre catálogos diferentes). Extraído de
// src/app/api/marketplaces/mapa-anuncios/sugestoes/route.ts pra reuso em
// src/app/api/empresas/parcerias/[id]/sugestoes-vinculo/route.ts.
export function similaridadeTexto(a: string | null | undefined, b: string | null | undefined): number {
  const tokenizar = (s: string) => (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)

  const setA = new Set(tokenizar(a ?? ''))
  const setB = new Set(tokenizar(b ?? ''))
  if (setA.size === 0 || setB.size === 0) return 0

  let intersecao = 0
  for (const w of setA) if (setB.has(w)) intersecao++
  const uniao = new Set([...setA, ...setB]).size
  return Math.round((intersecao / uniao) * 100)
}

export function normalizarChave(v: string | null | undefined): string {
  return (v ?? '').toString().trim().toUpperCase()
}
