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

// ── Preço por quantidade (atacado) ──────────────────────────────────────────
//
// Diferente da promoção, que é campanha com data: a faixa de quantidade é
// política de venda e vale sempre. Por isso não passa por `promocaoVigente` —
// quem leva 12 paga o preço de 12 mesmo fora de promoção.

export type FaixaQuantidade = { qtd: number; preco: number }

export type ProdutoComFaixas = ProdutoComPromocao & {
  precos_quantidade?: unknown
}

/**
 * Lê as faixas do produto, descartando o que não serve.
 *
 * O dado vem de JSONB, então pode ter qualquer forma — inclusive de uma versão
 * anterior da tela. Faixa sem quantidade ou sem preço positivo é ignorada em
 * vez de virar preço zero numa venda.
 */
export function faixasDoProduto(produto: ProdutoComFaixas): FaixaQuantidade[] {
  const bruto = produto.precos_quantidade
  if (!Array.isArray(bruto)) return []
  return bruto
    .map((f: any) => ({ qtd: Math.trunc(Number(f?.qtd)), preco: Number(f?.preco) }))
    .filter(f => Number.isFinite(f.qtd) && f.qtd > 1 && Number.isFinite(f.preco) && f.preco > 0)
    .sort((a, b) => a.qtd - b.qtd)
    .slice(0, 3)
}

/**
 * Preço unitário para esta quantidade.
 *
 * Vale a faixa de maior `qtd` que couber. Se nenhuma couber — ou se o produto
 * não tiver faixa nenhuma —, cai no preço vigente de sempre, então produto sem
 * atacado configurado se comporta exatamente como antes.
 *
 * A faixa NÃO compete com a promoção: o menor preço ganha. Uma campanha
 * agressiva não pode sair mais cara para quem leva mais, que é o que
 * aconteceria se a faixa simplesmente sobrescrevesse.
 */
export function precoPorQuantidade(
  produto: ProdutoComFaixas,
  quantidade: number,
  agora: Date = new Date(),
): number {
  const base = precoVigente(produto, agora)
  // Devolução entra no PDV com quantidade negativa, e a faixa vale igual: quem
  // devolve 12 unidades comprou 12 e pagou o preço de 12. Sem o módulo, o
  // sistema devolveria o preço cheio e a loja pagaria a mais.
  const qtd = Math.abs(Number(quantidade) || 0)
  if (qtd <= 1) return base

  const aplicavel = faixasDoProduto(produto).filter(f => qtd >= f.qtd).pop()
  if (!aplicavel) return base
  return base > 0 ? Math.min(base, aplicavel.preco) : aplicavel.preco
}
