// PREÇO POR VARIAÇÃO na precificação.
//
// Num anúncio com variações, cada variação tem preço próprio na plataforma e,
// quase sempre, um produto próprio no sistema — com custo próprio. Medido em
// 06/10/2026 na TikTok: o "Kit 4 Pisca Led" tem duas variações a 21,89 e
// 38,90, cada uma ligada a um produto diferente. Um preço só para o anúncio
// não diz qual variação recebe; calcular pelo produto do anúncio daria o
// mesmo preço para itens de custo diferente.
//
// Por isso, nas plataformas abaixo, a precificação trabalha com UMA LINHA POR
// VARIAÇÃO: o custo sai do produto da variação, o preço atual é o da
// variação, e o envio vai para o SKU dela.
//
// TikTok (envio por SKU) e Shopee (envio por model_id) — as duas aceitam
// preço diferente em cada variação. Medido em 11/10/2026: 104 anúncios da
// Shopee com variações a preços diferentes.
//
// MERCADO LIVRE É DIFERENTE: no anúncio clássico com variações, o preço é UM
// SÓ para todas ("o preço deve ser o mesmo para cada variação" — doc de
// variações do ML; preço por variação lá só existe no modelo novo de User
// Products, em que cada variação já é um anúncio separado). Medido: 1 de 203
// anúncios do ML com variações tinha preços diferentes. Então no ML a linha
// continua sendo do anúncio, o preço vai igual para todas as variações, e o
// cálculo usa o produto de MAIOR CUSTO entre elas — para nenhuma variação
// vender abaixo da regra.

export const PLATAFORMAS_PRECO_POR_VARIACAO = new Set(['tiktok', 'shopee'])
export const PLATAFORMAS_PRECO_UNICO_NAS_VARIACOES = new Set(['mercadolivre'])

export function precificaPorVariacao(plataforma: string, temVariacao: boolean | null | undefined): boolean {
  return !!temVariacao && PLATAFORMAS_PRECO_POR_VARIACAO.has(plataforma)
}

/** Anúncio com variações num canal que exige o MESMO preço em todas (ML). */
export function precoUnicoNasVariacoes(plataforma: string, temVariacao: boolean | null | undefined): boolean {
  return !!temVariacao && PLATAFORMAS_PRECO_UNICO_NAS_VARIACOES.has(plataforma)
}

/** Colunas da variação que a precificação usa. */
export const COLUNAS_VARIACAO_PRECO = 'id, anuncio_id, produto_id, model_id, nome_variacao, sku_variacao, preco'

export type VariacaoPreco = {
  id: string
  anuncio_id: string
  produto_id: string | null
  model_id: string | null
  nome_variacao: string | null
  sku_variacao: string | null
  preco: number | string | null
}

/** Identidade de uma linha da precificação: o anúncio, ou o anúncio + variação. */
export function chaveDoItem(anuncioId: string, variacaoId?: string | null): string {
  return variacaoId ? `${anuncioId}:${variacaoId}` : anuncioId
}

export function nomeDaVariacao(v: Pick<VariacaoPreco, 'nome_variacao' | 'sku_variacao' | 'model_id'>): string {
  return v.nome_variacao?.trim()
    || (v.sku_variacao?.trim() ? `SKU ${v.sku_variacao.trim()}` : '')
    || (v.model_id ? `SKU ${v.model_id}` : 'variação')
}

/**
 * O anúncio "visto pela variação": mesmo anúncio (canal, campanhas, dados da
 * plataforma), com o preço da variação no lugar do preço do anúncio.
 *
 * A promoção LOCAL do anúncio não passa para a variação: ela foi definida
 * sobre o preço do anúncio e não diz nada sobre o de cada variação. Campanha
 * da plataforma vale pela variação: `variacao_model_id` faz a busca do item
 * da campanha olhar só o desta variação (a Shopee registra um por model_id).
 */
export function anuncioDaVariacao<A extends Record<string, unknown>>(
  anuncio: A, v: Pick<VariacaoPreco, 'preco'> & Partial<Pick<VariacaoPreco, 'model_id'>>,
): A {
  return {
    ...anuncio,
    variacao_model_id: v.model_id ?? null,
    preco_venda: v.preco != null ? Number(v.preco) : null,
    preco_promocional: null,
    promo_inicio: null,
    promo_fim: null,
    tem_variacao: false,
  }
}

/**
 * Produto que define o preço único de um anúncio com variações (ML): o de
 * MAIOR custo entre os produtos das variações (e o do próprio anúncio). Um
 * preço calculado pelo mais barato deixaria as variações caras abaixo da
 * regra — ou no prejuízo.
 *
 * `aviso` explica na tela por que aquele produto, quando há escolha.
 */
export async function produtoDoPrecoUnico<P extends { id: string; nome?: string | null }>(
  variacoes: { produtos?: unknown }[],
  produtoDoAnuncio: P | null,
  custoDe: (p: P) => Promise<number>,
): Promise<{ produto: P | null; aviso: string | null }> {
  const candidatos = new Map<string, P>()
  if (produtoDoAnuncio) candidatos.set(produtoDoAnuncio.id, produtoDoAnuncio)
  for (const v of variacoes) {
    const p = v.produtos as P | null | undefined
    if (p?.id) candidatos.set(p.id, p)
  }
  const n = variacoes.length
  const mesmoPreco = n > 1 ? `Mercado Livre: o mesmo preço vale para as ${n} variações` : null
  if (candidatos.size <= 1) return { produto: [...candidatos.values()][0] ?? null, aviso: mesmoPreco }

  let melhor: { p: P; custo: number } | null = null
  for (const p of candidatos.values()) {
    const custo = await custoDe(p)
    if (!melhor || custo > melhor.custo) melhor = { p, custo }
  }
  return {
    produto: melhor!.p,
    aviso: `${mesmoPreco ?? 'Mercado Livre: preço único para as variações'} — calculado pelo produto de maior custo (${melhor!.p.nome ?? 'produto'}), para nenhuma variação ficar abaixo da regra`,
  }
}
