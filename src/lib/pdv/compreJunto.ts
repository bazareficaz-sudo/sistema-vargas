// O PEDIDO DO COMPRE JUNTO, separado do banco e do HTTP.
//
// O PDV desktop manda os produtos do carrinho e recebe quem costuma sair
// junto com eles — a mesma `compre_junto_sugestoes` que o PDV web chama
// direto pelo Supabase. O desktop não pode: a função não é do `anon`, e a
// chave anônima não deve voltar a ganhar leitura de catálogo.
//
// O que fica aqui é o que se testa sem banco: o que a rota aceita.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Um carrinho de balcão não passa disto; mais é pedido malformado. */
export const MAX_IDS = 50
export const LIMITE_PADRAO = 6
export const LIMITE_MAXIMO = 20

export type PedidoCompreJunto =
  | { ok: true; ids: string[]; limite: number }
  | { ok: false; erro: string }

/**
 * `?ids=a,b,c&limite=6`. Ids repetidos colapsam; id que não é UUID recusa o
 * pedido inteiro em vez de ser descartado em silêncio — um id de catálogo
 * herdado do Base44 (ObjectId de 24 hex) é bug do terminal, e engolir isso
 * esconderia o bug atrás de "nenhuma sugestão".
 */
export function lerPedidoCompreJunto(params: URLSearchParams): PedidoCompreJunto {
  const brutos = (params.get('ids') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  const ids = [...new Set(brutos.map((s) => s.toLowerCase()))]

  if (ids.length === 0) return { ok: false, erro: 'Informe ao menos um produto em `ids`.' }
  if (ids.length > MAX_IDS) return { ok: false, erro: `No máximo ${MAX_IDS} produtos por consulta.` }
  const invalido = ids.find((id) => !UUID_RE.test(id))
  if (invalido) return { ok: false, erro: `Produto com id inválido: ${invalido}` }

  const limiteBruto = params.get('limite')
  let limite = LIMITE_PADRAO
  if (limiteBruto !== null && limiteBruto !== '') {
    const n = Number(limiteBruto)
    if (!Number.isInteger(n) || n < 1) return { ok: false, erro: '`limite` precisa ser inteiro positivo.' }
    limite = Math.min(n, LIMITE_MAXIMO)
  }

  return { ok: true, ids, limite }
}

export type LinhaCompreJunto = {
  produto_id: string
  base_id: string
  vezes: number
  fixo: boolean
}

/**
 * Só o que é DESTA empresa sai pela rota.
 *
 * A função do banco não filtra empresa — ela confia em quem chama (o PDV web
 * roda sob RLS do usuário). Aqui quem chama é o service role, que enxerga
 * tudo; então a rota filtra a entrada E a saída pela empresa do terminal, que
 * vem do banco e nunca do pedido.
 */
export function soDaEmpresa(linhas: LinhaCompreJunto[], idsDaEmpresa: Set<string>): LinhaCompreJunto[] {
  return linhas.filter((l) => idsDaEmpresa.has(l.produto_id) && idsDaEmpresa.has(l.base_id))
}
