import type { PoliticaPreco, ProdutoCard } from './tipos'

// A política de preços da vitrine, do lado do TypeScript.
//
// Divisão de trabalho com o banco, e ela é deliberada:
//
//   O BANCO decide QUANTO custa à vista. `loja_vitrine_produtos.preco_pix`
//   já sai calculado (ver supabase-loja-precos.sql), porque quem lê esse
//   número é a listagem, a busca, a página do produto e a conferência do
//   carrinho — quatro lugares que não podem divergir.
//
//   O TYPESCRIPT decide COMO isso é dito. Parcelamento é aritmética de
//   apresentação: não muda o que a loja cobra, muda a frase na tela. Fazer
//   isso em SQL exigiria a mesma conta dentro da view, repetida por linha,
//   para um texto que só o navegador usa.
//
// O vocabulário ("em até 10x de R$ 10,00 sem juros") é o mesmo de
// `src/lib/orcamentos/condicoes.ts`, de propósito: a loja não pode dizer ao
// cliente uma condição com palavras diferentes das que o balcão usa.
//
// NADA aqui cobra nada. O checkout é a Fase 3; até lá o parcelamento é
// informação de vitrine, e a frase é escrita para não prometer meio de
// pagamento que a loja ainda não processa.

/** Centavos. A mesma regra do orçamento — arredonda, não trunca. */
const cent = (v: number) => Math.round(v * 100) / 100

/**
 * O formatador de dinheiro da loja. Um só.
 *
 * O design system o reexporta como `real` (ver `components/loja/ds`), em vez
 * de manter o seu — duas instâncias de `Intl.NumberFormat` não divergiriam
 * hoje, mas é exatamente assim que começam as divergências que este projeto
 * já catalogou.
 */
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const brl = (v: number) => BRL.format(Number.isFinite(v) ? v : 0)

/**
 * A política que vale quando a loja não configurou nada.
 *
 * É a Fase 1 inteira: um preço só. Existe como constante para nenhum
 * componente precisar tratar `politica` como opcional e inventar o próprio
 * padrão — que é como dois padrões diferentes nascem.
 */
export const PRECO_UNICO: PoliticaPreco = {
  exibicao: 'preco_unico',
  pixDescontoPct: 0,
  pixRotulo: 'no Pix',
  parcelasMax: null,
  parcelasSemJuros: 0,
  jurosMes: 0,
  parcelaMinima: 0,
}

/**
 * O percentual do riscado para o preço praticado — o número do selo "−25%".
 *
 * Mora aqui, e não no card, porque o selo e o bloco de preço têm de contar a
 * mesma história: um card que anuncia −25% ao lado de um "De" que dá 24% é o
 * tipo de detalhe que o cliente confere.
 *
 * Zero quando não há riscado. O riscado só vale quando é MAIOR que o preço —
 * a view garante isso no banco, e a repetição aqui protege quem chamar com
 * dado de outra origem.
 */
export function descontoPercentual(preco: number, precoDe: number | null): number {
  if (precoDe == null || !(precoDe > preco) || !(precoDe > 0)) return 0
  return Math.round((1 - preco / precoDe) * 100)
}

export type Parcelamento = {
  vezes: number
  valorParcela: number
  /** Soma das parcelas. Igual ao preço quando é sem juros. */
  total: number
  semJuros: boolean
}

/**
 * O melhor parcelamento que a política permite para este preço.
 *
 * "Melhor" é o maior número de vezes que sobrevive às duas travas: o teto da
 * loja e o piso da parcela. `null` quando não há parcelamento a oferecer —
 * e `null` é a resposta certa, não "1x", porque "em até 1x" não é uma frase
 * que alguém escreva numa vitrine.
 */
export function melhorParcelamento(preco: number, pol: PoliticaPreco): Parcelamento | null {
  const max = pol.parcelasMax ?? 0
  if (!(preco > 0) || max < 2) return null

  // Acima do limite sem juros só existe oferta se houver taxa configurada.
  // Sem taxa, deixar o teto valer anunciaria 12x SEM JUROS sem ninguém ter
  // decidido isso — o tipo de promessa que o cliente cobra no balcão.
  const teto = pol.jurosMes > 0 ? max : Math.min(max, pol.parcelasSemJuros)
  if (teto < 2) return null

  // O piso da parcela manda no número de vezes. Um produto de R$ 12,00 numa
  // loja que parcela em 10x com piso de R$ 5,00 vira 2x de R$ 6,00 — não
  // "10x de R$ 1,20".
  const porPiso = pol.parcelaMinima > 0 ? Math.floor(preco / pol.parcelaMinima) : teto
  const vezes = Math.min(teto, porPiso)
  if (vezes < 2) return null

  if (vezes <= pol.parcelasSemJuros) {
    return { vezes, valorParcela: cent(preco / vezes), total: cent(preco), semJuros: true }
  }

  // Tabela Price — a conta do cartão. Sem ela, "12x com juros de 2% a.m."
  // teria de virar um número inventado na tela.
  const i = pol.jurosMes / 100
  const fator = (Math.pow(1 + i, vezes) * i) / (Math.pow(1 + i, vezes) - 1)
  const valorParcela = cent(preco * fator)
  return { vezes, valorParcela, total: cent(valorParcela * vezes), semJuros: false }
}

/** "em até 10x de R$ 10,00 sem juros". Frase pronta, sem ponto final. */
export function textoParcelamento(p: Parcelamento): string {
  return `em até ${p.vezes}x de ${brl(p.valorParcela)}${p.semJuros ? ' sem juros' : ''}`
}

/**
 * "no Pix" — o rótulo curto, da linha secundária.
 *
 * É o texto que a Fase 1 já mostrava, e continua sendo, para uma loja no ar
 * não ver a frase mudar sozinha no dia em que esta migração roda.
 */
export function rotuloAVista(pol: PoliticaPreco): string {
  return pol.pixRotulo?.trim() || 'à vista'
}

/**
 * "à vista no Pix" — a forma longa, só onde o à vista é o destaque.
 *
 * Ali ele precisa dizer o que é, porque está sendo contrastado com um preço
 * parcelado logo abaixo; na linha secundária o "à vista" seria redundante.
 */
export function textoAVista(pol: PoliticaPreco): string {
  const rotulo = pol.pixRotulo?.trim()
  return rotulo ? `à vista ${rotulo}` : 'à vista'
}

/**
 * Como um produto deve ser exibido — a decisão inteira num objeto só.
 *
 * Existe para o card e a página do produto não repetirem a mesma cadeia de
 * `if`. Se repetissem, um dia o card destacaria a promoção e a página não.
 */
export type ExibicaoPreco = {
  /** O preço que ganha o tamanho grande. */
  destaque: number
  /** Riscado. Só quando é maior que o preço praticado. */
  de: number | null
  /** O preço à vista, quando existe e é menor que o praticado. */
  aVista: number | null
  /** O preço normal, quando ele NÃO é o destaque (promoção vigente). */
  normal: number | null
  parcelamento: Parcelamento | null
  /** Verdadeiro quando o destaque é o à vista, e não o preço normal. */
  aVistaEmDestaque: boolean
  /** Percentual do riscado para o praticado. 0 quando não há riscado. */
  descontoPct: number
}

/**
 * A regra de exibição, num lugar só.
 *
 * Fora de 'dois_precos' o resultado é exatamente o que a Fase 1 fazia — e é
 * assim que uma loja no ar não muda de aparência no dia em que esta migração
 * roda. Ligar é decisão de quem opera, na aba Preços.
 *
 * Dentro de 'dois_precos':
 *
 *   sem promoção → o preço normal é o destaque, com o parcelamento embaixo
 *                  e o à vista como terceira linha.
 *   com promoção → o à VISTA sobe para o destaque. É o momento em que o
 *                  menor preço merece ser a primeira coisa que o olho
 *                  encontra; o normal desce, com o parcelamento junto.
 */
export function exibicaoPreco(
  p: Pick<ProdutoCard, 'preco' | 'precoDe' | 'precoPix'>,
  pol: PoliticaPreco,
): ExibicaoPreco {
  // O riscado só existe quando é MAIOR que o praticado. A view já garante
  // isso no banco; a repetição aqui é barata e protege quem chamar esta
  // função com dado de outra origem.
  const de = p.precoDe != null && p.precoDe > p.preco ? p.precoDe : null
  const descontoPct = descontoPercentual(p.preco, de)

  const aVista = p.precoPix != null && p.precoPix > 0 && p.precoPix < p.preco ? p.precoPix : null

  const base: ExibicaoPreco = {
    destaque: p.preco, de, aVista, normal: null,
    parcelamento: null, aVistaEmDestaque: false, descontoPct,
  }

  if (pol.exibicao !== 'dois_precos') return base

  const parcelamento = melhorParcelamento(p.preco, pol)

  // Promoção vigente E um à vista para mostrar: os dois trocam de lugar.
  // Sem à vista não há troca — destacar o preço normal duas vezes não é
  // destaque, é repetição.
  if (de && aVista) {
    return { ...base, destaque: aVista, normal: p.preco, parcelamento, aVistaEmDestaque: true }
  }

  return { ...base, parcelamento }
}
