// A URL do servidor de impressão é publicada por um terminal e CONSUMIDA por
// outros, que vão mandar requisições para ela sozinhos. Ou seja: quem escreve
// aqui está dizendo aos outros terminais para onde falar.
//
// Por isso a validação não é cosmética. Sem ela, um terminal comprometido
// publicaria `file://`, `javascript:` ou um endereço interno da rede, e os
// demais terminais fariam a requisição obedientemente.

const ESQUEMAS = new Set(['http:', 'https:'])

export function urlDeImpressaoValida(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (!s || s.length > 500) return false
  try {
    const u = new URL(s)
    if (!ESQUEMAS.has(u.protocol)) return false
    // Sem credencial embutida: `https://alguem:senha@host` é uma forma
    // conhecida de esconder o host verdadeiro de quem lê a URL de relance.
    if (u.username || u.password) return false
    return !!u.hostname
  } catch {
    return false
  }
}
