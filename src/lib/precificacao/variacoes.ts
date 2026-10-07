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
// Começa pela TikTok, onde o envio por SKU já existe (lib/tiktok/write.ts).
// Shopee e Mercado Livre continuam no preço do anúncio até terem o mesmo
// tratamento.

export const PLATAFORMAS_PRECO_POR_VARIACAO = new Set(['tiktok'])

export function precificaPorVariacao(plataforma: string, temVariacao: boolean | null | undefined): boolean {
  return !!temVariacao && PLATAFORMAS_PRECO_POR_VARIACAO.has(plataforma)
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
 * da plataforma continua valendo pelo anúncio, que é como ela é registrada.
 */
export function anuncioDaVariacao<A extends Record<string, unknown>>(anuncio: A, v: Pick<VariacaoPreco, 'preco'>): A {
  return {
    ...anuncio,
    preco_venda: v.preco != null ? Number(v.preco) : null,
    preco_promocional: null,
    promo_inicio: null,
    promo_fim: null,
    tem_variacao: false,
  }
}
