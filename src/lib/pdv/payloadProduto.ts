// O QUE UM PDV PODE DIZER SOBRE UM PRODUTO — e nada além disso.
//
// ── A COLUNA QUE NÃO PODE ESTAR AQUI ─────────────────────────────────────
//
// `estoque`.
//
// Ela é escrita por um caminho só: o CAS de `_ajustarEstoqueCAS`, que move
// `produtos.estoque`, `produto_estoque.quantidade` e `estoque_movimentacoes`
// juntos, com compare-and-set e rastro. Aceitar `estoque` numa edição de
// cadastro criaria um SEGUNDO escritor do mesmo saldo — sem CAS, sem
// movimentação, sem espelho no depósito.
//
// Não é hipótese: a divergência entre `produtos.estoque` e `produto_estoque`
// que apareceu em 13/09/2026, e que custou a reconciliação de 472 produtos,
// nasceu exatamente de um caminho que mexia num dos dois sem o outro.
//
// `estoque_minimo` também fica de fora: ele é editado no ERP web, na
// listagem de produtos, e o PDV só o lê.
//
// ── O RESTO ──────────────────────────────────────────────────────────────
//
// Fiscal (NCM, CFOP, CSTs) e comercial (nome, preços, categoria, marca,
// unidade) são o que a tela de produto do balcão edita hoje, e é a lista
// literal de `api.atualizarProduto`. Campo fora dela é ignorado, não é erro.

export type ProdutoEditavel = Record<string, string | number | boolean | null>

/**
 * Os campos editáveis, com o tipo de cada um.
 *
 * `undefined` = o PDV não falou sobre este campo. `null` = ele falou, e disse
 * "vazio" — que é diferente, e é como se limpa um NCM errado. A distinção
 * existe no legado (`if (dados.x !== undefined)`) e é preservada.
 */
const CAMPOS = {
  nome: 'texto',
  ncm: 'texto',
  cfop: 'texto',
  icms_cst: 'texto',
  icms_origem: 'numero',
  pis_cst: 'texto',
  cofins_cst: 'texto',
  categoria: 'texto',
  marca: 'texto',
  unidade: 'texto',
  preco_venda: 'numero',
  preco_custo: 'numero',
  disponivel_pdv: 'booleano',
} as const

/** Nunca aceito, mesmo que chegue. Cada um com a razão de estar aqui. */
export const CAMPOS_PROIBIDOS = [
  'estoque',          // ← só pelo CAS, ver o cabeçalho
  'estoque_minimo',   // ← do ERP
  'empresa_id',       // ← do token
  'ativo',            // ← inativar produto é decisão do ERP
  'id',
] as const

export function validarAtualizacaoProduto(
  corpo: Record<string, unknown>,
): { ok: true; dados: ProdutoEditavel } | { ok: false; erro: string } {
  const dados: ProdutoEditavel = {}

  for (const [campo, tipo] of Object.entries(CAMPOS)) {
    const v = corpo?.[campo]
    if (v === undefined) continue

    if (v === null) { dados[campo] = null; continue }

    if (tipo === 'numero') {
      const n = Number(v)
      if (!Number.isFinite(n)) return { ok: false, erro: `${campo} não é um número.` }
      dados[campo] = n
      continue
    }
    if (tipo === 'booleano') { dados[campo] = !!v; continue }

    if (typeof v !== 'string') return { ok: false, erro: `${campo} não é texto.` }
    const s = v.trim()
    dados[campo] = s ? s.slice(0, 300) : null
  }

  // Nome existe, mas em branco, não é edição — é apagar o produto da busca.
  if (dados.nome !== undefined && !dados.nome) {
    return { ok: false, erro: 'nome não pode ficar vazio.' }
  }

  if (!Object.keys(dados).length) return { ok: false, erro: 'Nada para atualizar.' }
  return { ok: true, dados }
}
