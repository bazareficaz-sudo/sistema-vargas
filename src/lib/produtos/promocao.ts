// Vigência de promoção — regra única para todo o sistema.
//
// Antes disso, `promocao_inicio`/`promocao_fim` eram gravados no cadastro do
// produto mas ninguém os consultava: PDV e Orçamentos olhavam só o par
// `promocao_ativa` + `preco_promocional`. Na prática, uma promoção com data
// final no passado continuava valendo para sempre.
//
// Com a promoção passando a ser definida em massa na entrada de mercadoria
// (uma data de início e uma de fim para o lote inteiro), essa data precisa
// significar alguma coisa — senão o gestor programa uma promoção de fim de
// semana e ela nunca termina.

export type ProdutoComPromocao = {
  preco_venda?: number | null
  preco_promocional?: number | null
  promocao_ativa?: boolean | null
  promocao_inicio?: string | null
  promocao_fim?: string | null
}

/**
 * A promoção do produto está valendo agora?
 *
 * Exige, nesta ordem: o interruptor ligado, um preço promocional maior que
 * zero e menor que o preço normal, e a data de hoje dentro da janela.
 * Data ausente = sem limite daquele lado (o comportamento que já existia
 * para quem nunca preencheu data nenhuma).
 */
export function promocaoVigente(produto: ProdutoComPromocao, agora: Date = new Date()): boolean {
  if (!produto.promocao_ativa) return false

  const promo = Number(produto.preco_promocional ?? 0)
  if (!(promo > 0)) return false

  const normal = Number(produto.preco_venda ?? 0)
  if (normal > 0 && promo >= normal) return false

  const inicio = produto.promocao_inicio ? new Date(produto.promocao_inicio) : null
  if (inicio && !Number.isNaN(inicio.getTime()) && agora < inicio) return false

  const fim = produto.promocao_fim ? new Date(produto.promocao_fim) : null
  if (fim && !Number.isNaN(fim.getTime()) && agora > fim) return false

  return true
}

/** Preço que deve ser cobrado agora: o promocional se estiver vigente, senão o normal. */
export function precoVigente(produto: ProdutoComPromocao, agora: Date = new Date()): number {
  return promocaoVigente(produto, agora)
    ? Number(produto.preco_promocional ?? 0)
    : Number(produto.preco_venda ?? 0)
}
