// O QUE A REGRA DE ESTOQUE REALMENTE FAZ.
//
// Escrito em 03/09/2026 a partir de uma pergunta do gestor: "complemento
// 1000 e risco 1000 — envia 1010 e pausa quando o estoque chegar a 1000?".
// A primeira metade estava certa e a segunda não, e a tela não ajudava.
//
// A ORDEM DAS DUAS CONTAS É O QUE ENGANA. Em `aplicarRegra.ts`:
//
//   estoqueNovo = saldo + complementar
//   paraPausar  = estoqueNovo <= risco
//
// O risco é comparado contra o valor JÁ COM o complemento somado. Então
// "pausa se estoque ≤ 1000" não fala do estoque real: fala do enviado. Com
// complemento 1000, pausar exige `saldo + 1000 <= 1000`, ou seja, saldo ≤ 0.
//
// O caso que morde de verdade é o contrário: complemento 1000 e risco 5, que
// alguém configura pensando "pausa quando sobrar 5". A conta vira
// `saldo + 1000 <= 5`, isto é, saldo ≤ -995. O anúncio NUNCA pausa, e nada
// na tela diz isso.

export type ExplicacaoEstoque = {
  /** O que vai para o canal com o saldo de exemplo. */
  envia: number
  /**
   * O saldo REAL a partir do qual o anúncio pausa. `null` quando não há
   * risco configurado (nunca pausa por estoque).
   */
  pausaComSaldoReal: number | null
  /**
   * Verdadeiro quando o limiar exige saldo negativo — ou seja, o anúncio
   * nunca pausa na prática. É o engano silencioso que esta função existe
   * para expor.
   */
  nuncaPausa: boolean
  /** Uma frase pronta para a tela, sem jargão. */
  frase: string
}

/**
 * Traduz complemento e risco para o que o operador precisa saber.
 *
 * `saldoExemplo` é só para ilustrar o envio — a regra do limiar não depende
 * dele. Usa 10 por padrão porque é um número que ninguém confunde com o
 * complemento.
 */
export function explicarRegraEstoque(params: {
  /** Aceita string porque vem de campo de formulario, onde vazio e '' e nao null. */
  complementar?: number | string | null
  risco?: number | string | null
  saldoExemplo?: number
}): ExplicacaoEstoque {
  const complementar = Number(params.complementar ?? 0) || 0
  // VAZIO E ZERO SAO COISAS DIFERENTES: risco 0 pausa quando zera; risco
  // ausente nunca pausa. Um `Number('') === 0` apagaria essa distincao.
  const risco = params.risco === null || params.risco === undefined || params.risco === ''
    ? null
    : Number(params.risco)
  const saldo = Number(params.saldoExemplo ?? 10)

  const envia = saldo + complementar

  if (risco === null || Number.isNaN(risco)) {
    return {
      envia,
      pausaComSaldoReal: null,
      nuncaPausa: false,
      frase: complementar !== 0
        ? `Com ${saldo} em estoque, envia ${envia} ao canal. Sem estoque de risco, o anúncio não pausa sozinho.`
        : `Com ${saldo} em estoque, envia ${envia} ao canal. Sem estoque de risco, o anúncio não pausa sozinho.`,
    }
  }

  // `saldo + complementar <= risco`  ⇔  `saldo <= risco - complementar`
  const limiar = risco - complementar
  const nuncaPausa = limiar < 0

  const inicio = `Com ${saldo} em estoque, envia ${envia} ao canal.`

  if (nuncaPausa) {
    return {
      envia, pausaComSaldoReal: limiar, nuncaPausa,
      frase: `${inicio} ATENÇÃO: com complemento ${complementar} e risco ${risco}, o anúncio só pausaria com `
        + `saldo ${limiar} — ou seja, NUNCA pausa. O risco é comparado com o valor já somado ao complemento.`,
    }
  }

  return {
    envia, pausaComSaldoReal: limiar, nuncaPausa,
    frase: complementar !== 0
      ? `${inicio} Pausa quando o estoque REAL chegar a ${limiar} `
        + `(o risco ${risco} é comparado com o valor já somado ao complemento ${complementar}).`
      : `${inicio} Pausa quando o estoque chegar a ${limiar}.`,
  }
}
