// Busca por várias palavras, em qualquer ordem.
//
// Procurar "tomada barra" com um único ilike da frase inteira não acha
// "TOMADA PARA EXTENSÃO BARRA 5 TOMADAS", porque no nome as duas palavras
// estão separadas por outras. Quem procura no balcão digita os pedaços que
// lembra, não o nome exato.
//
// A regra aqui: cada palavra vira um filtro próprio. Dentro da palavra vale
// qualquer uma das colunas (nome, sku, ean...); entre as palavras vale E —
// todas precisam aparecer, em qualquer posição.

/** Teto de palavras por busca, para não montar uma consulta gigante. */
const MAX_TERMOS = 6

export function separarTermos(texto: string): string[] {
  return texto
    // Vírgula e parênteses são sintaxe de filtro no PostgREST — deixá-los
    // passar quebra a consulta inteira. Ninguém digita isso procurando
    // produto, então viram espaço.
    .replace(/[(),]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, MAX_TERMOS)
}

/**
 * Aplica a busca multi-palavra a um query builder do supabase-js.
 *
 * Cada `.or()` encadeado é combinado com E pelo PostgREST — verificado
 * contra a base: buscar "tomada" E "xyzinexistente" devolve zero, provando
 * que o segundo filtro restringe o primeiro em vez de substituí-lo.
 */
/** Qualquer query builder do supabase-js: `.or()` devolve ele mesmo. */
interface FiltravelPorOu<T> { or(filtro: string): T }

export function aplicarBuscaPorTermos<T extends FiltravelPorOu<T>>(
  qb: T, texto: string, colunas: string[],
): T {
  let out = qb
  for (const termo of separarTermos(texto)) {
    out = out.or(colunas.map(c => `${c}.ilike.%${termo}%`).join(','))
  }
  return out
}
