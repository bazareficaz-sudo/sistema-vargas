// GTIN DOS ANÚNCIOS DA SHOPEE — regras puras (tela e testes).
//
// Sem GTIN, a Shopee passou a recusar alteração no anúncio — inclusive o
// estoque, que ela "aceita" e não aplica (medido em 20/10/2026: torneiras
// Acquabios com produto zerado seguiram com 1000; pausar deu "The GTIN code
// is mandatory"). Na varredura do mesmo dia, 578 dos 924 anúncios ativos não
// tinham GTIN.
//
// O que se manda:
//   • o EAN do produto mapeado, quando é um GTIN de verdade;
//   • "00" — é como a Shopee guarda "produto sem GTIN" (11 anúncios da loja
//     já estavam assim, marcados pelo Seller Centre).
// O que NÃO se manda: código inventado. GTIN é registro da GS1, e a Shopee
// confere na base dela ("Verified by GS1"); número aleatório pode ser de
// outro produto. E o EAN interno que o sistema gera (prefixo 2, "circulação
// restrita" — ver lib/produtos/ean.ts) também não: ele só vale dentro da loja.

export const SEM_GTIN = '00'

/** Dígito verificador GS1 (EAN-8, UPC-12, EAN-13, GTIN-14). */
function digitoConfere(codigo: string): boolean {
  const d = codigo.split('').map(Number)
  const dv = d.pop()!
  const soma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (soma % 10)) % 10 === dv
}

/**
 * O EAN do cadastro serve de GTIN no marketplace? Precisa ter o tamanho e o
 * dígito certos e não ser de circulação restrita (EAN-13 começando por 2, a
 * faixa que o sistema usa para código interno).
 */
export function gtinParaMarketplace(ean: string | null | undefined): string | null {
  const g = String(ean ?? '').replace(/\D/g, '')
  if (!/^(\d{8}|\d{12,14})$/.test(g)) return null
  if (/^0+$/.test(g) || !digitoConfere(g)) return null
  if (g.length === 13 && g.startsWith('2')) return null
  return g
}

/**
 * Código digitado/escolhido no modal de edição: "00" (sem GTIN) ou um código
 * de 8, 12, 13 ou 14 dígitos com o dígito verificador certo. O de uso interno
 * (prefixo 2) passa — é escolha consciente da pessoa, com aviso na tela.
 */
export function gtinAceitoNaEdicao(codigo: string): boolean {
  const g = codigo.replace(/\D/g, '')
  if (codigo.trim() === SEM_GTIN) return true
  return /^(\d{8}|\d{12,14})$/.test(g) && !/^0+$/.test(g) && digitoConfere(g)
}

/** Código de circulação restrita (uso interno da loja, prefixo 2). */
export const ehCodigoInterno = (codigo: string) => /^2\d{12}$/.test(codigo.replace(/\D/g, ''))

/** O que o anúncio tem hoje na Shopee. */
export function situacaoGtin(gtinCode: unknown): 'tem' | 'sem_gtin' | 'falta' | 'invalido' {
  const g = typeof gtinCode === 'string' ? gtinCode.trim() : gtinCode == null ? '' : String(gtinCode)
  if (!g) return 'falta'
  if (g === SEM_GTIN) return 'sem_gtin'
  return gtinParaMarketplace(g) ? 'tem' : 'invalido'
}

export type Proposta = { gtin: string; origem: 'ean_do_produto' | 'sem_gtin' }

/** Uma variação sem GTIN de um anúncio com variações. */
export type ModeloGtin = {
  modelId: string
  nome: string
  produto: { id: string; nome: string; ean: string | null } | null
  proposta: Proposta | null
}

export type AnuncioGtin = {
  canalId: string
  canalNome: string
  itemId: string
  titulo: string
  foto: string | null
  /** Hoje na Shopee: vazio ou inválido (no anúncio, ou em alguma variação). */
  situacao: 'falta' | 'invalido'
  gtinAtual: string | null
  produto: { id: string; nome: string; ean: string | null } | null
  temVariacao: boolean
  /** Anúncio com variação: só as variações SEM GTIN — as outras não são tocadas. */
  modelos: ModeloGtin[]
  /**
   * O que o sistema propõe mandar. Anúncio com variação: `origem` diz se
   * todas vão com EAN do produto ou se alguma vai "sem GTIN".
   */
  proposta: Proposta | null
  /** Por que não há proposta. */
  pendencia: string | null
}

/** EAN do produto, ou "00" (sem GTIN) quando ele não tem um GTIN de verdade. */
export function propostaDoProduto(produto: { ean: string | null } | null): Proposta | null {
  if (!produto) return null
  const g = gtinParaMarketplace(produto.ean)
  return g ? { gtin: g, origem: 'ean_do_produto' } : { gtin: SEM_GTIN, origem: 'sem_gtin' }
}

/** Decide a proposta de um anúncio sem GTIN (com ou sem variação). */
export function propostaGtin(a: { produto: { ean: string | null } | null; temVariacao: boolean; modelos?: { produto: { ean: string | null } | null }[] }): Pick<AnuncioGtin, 'proposta' | 'pendencia'> {
  if (a.temVariacao) {
    const modelos = a.modelos ?? []
    if (!modelos.length) return { proposta: null, pendencia: 'variações sem GTIN não identificadas — varra de novo' }
    const semProduto = modelos.filter(m => !m.produto).length
    if (semProduto) return { proposta: null, pendencia: `${semProduto} variação(ões) sem produto mapeado — mapeie as variações para usar o EAN do cadastro` }
    const todasComEan = modelos.every(m => propostaDoProduto(m.produto)?.origem === 'ean_do_produto')
    return { proposta: { gtin: 'variacoes', origem: todasComEan ? 'ean_do_produto' : 'sem_gtin' }, pendencia: null }
  }
  if (!a.produto) return { proposta: null, pendencia: 'anúncio sem produto mapeado — mapeie para usar o EAN do cadastro' }
  return { proposta: propostaDoProduto(a.produto), pendencia: null }
}
