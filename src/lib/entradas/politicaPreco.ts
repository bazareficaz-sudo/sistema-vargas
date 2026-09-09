// O QUE ACONTECE COM O PREÇO DE VENDA QUANDO O CUSTO MUDA.
//
// A tela de Reajuste sempre teve uma resposta só, sem nunca ter perguntado:
// mantinha o markup e recalculava o preço. Isso é certo quando o custo sobe —
// e é justamente o que ninguém quer quando o custo cai. O fornecedor deu um
// desconto de 14% numa compra e o sistema, sozinho, derrubava o preço de
// venda de sete produtos junto: foi o que a nota da imagem mostrava, sete
// linhas de variação negativa que ninguém tinha pedido.
//
// Aqui a resposta passa a ser uma ESCOLHA, e a escolha vira padrão da empresa
// (empresa_config_comercial.politica_preco_custo_mudou) em vez de ficar na
// cabeça de quem lança a nota.
//
// O que este arquivo NÃO faz: decidir se o preço vale a pena. Ele só diz qual
// número aparece sugerido na tela. Toda linha continua editável e continua
// com a caixa "Atualizar" — desmarcá-la é, e continua sendo, o jeito de dizer
// "neste produto, nada".

export type PoliticaPreco = 'manter_markup' | 'manter_preco' | 'so_aumentar'

export const POLITICA_PADRAO: PoliticaPreco = 'manter_markup'

export const POLITICA_LABEL: Record<PoliticaPreco, string> = {
  manter_markup: 'Manter o markup — recalcula o preço de venda',
  manter_preco: 'Manter o preço de venda — recalcula o markup',
  so_aumentar: 'Só aumentar — se o custo cair, mantém o preço atual',
}

export const POLITICA_AJUDA: Record<PoliticaPreco, string> = {
  manter_markup: 'A margem percentual fica igual. Custo sobe, preço sobe; custo cai, preço cai.',
  manter_preco: 'O preço na prateleira não muda. Quem absorve a diferença é a margem.',
  so_aumentar: 'Repassa o aumento, mas não devolve a queda: o desconto do fornecedor vira margem.',
}

export function ehPolitica(v: unknown): v is PoliticaPreco {
  return v === 'manter_markup' || v === 'manter_preco' || v === 'so_aumentar'
}

const duasCasas = (v: number) => Math.round(v * 100) / 100

export function precoDoMarkup(custo: number, markup: number): number {
  return duasCasas(custo * (1 + markup / 100))
}

export function markupDoPreco(custo: number, preco: number): number {
  if (!custo) return 0
  return Math.round(((preco / custo) - 1) * 10000) / 100
}

export type EntradaPolitica = {
  /** Custo que o produto tinha antes desta nota. */
  custoAnterior: number
  /** Custo já com o rateio dos encargos desta nota. */
  custoNovo: number
  /** Preço de venda em vigor hoje. */
  precoAtual: number
  /** Markup em vigor hoje. */
  markupAtual: number
}

export function aplicarPolitica(
  politica: PoliticaPreco,
  { custoAnterior, custoNovo, precoAtual, markupAtual }: EntradaPolitica,
): { precoNovo: number; markup: number } {
  // Sem custo novo não há o que recalcular — dividir por ele daria markup
  // infinito, e sugerir preço zero seria pior que não sugerir nada.
  if (!(custoNovo > 0)) {
    return { precoNovo: duasCasas(precoAtual), markup: duasCasas(markupAtual) }
  }

  const manterPreco = () => ({
    precoNovo: duasCasas(precoAtual),
    markup: precoAtual > 0 ? markupDoPreco(custoNovo, precoAtual) : duasCasas(markupAtual),
  })

  switch (politica) {
    case 'manter_preco':
      return manterPreco()

    case 'so_aumentar':
      // Custo igual conta como "não subiu": repassar zero é manter o preço, e
      // é o mesmo resultado por qualquer um dos dois caminhos — mas dito
      // assim, não depende de arredondamento para dar certo.
      return custoNovo > custoAnterior
        ? { precoNovo: precoDoMarkup(custoNovo, markupAtual), markup: duasCasas(markupAtual) }
        : manterPreco()

    case 'manter_markup':
    default:
      return { precoNovo: precoDoMarkup(custoNovo, markupAtual), markup: duasCasas(markupAtual) }
  }
}
