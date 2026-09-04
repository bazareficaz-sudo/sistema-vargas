// "O CANAL JÁ ESTÁ COM ESTE NÚMERO" — quem responde, o espelho ou a medida?
//
// A fila pulava o anúncio quando `estoque_externo` (o que ACREDITAMOS ter
// mandado) batia com o que ela ia mandar. Isso é certo enquanto o espelho for
// verdade, e o espelho é escrito logo depois de um envio dado como aceito.
//
// O PROBLEMA MEDIDO EM 04/09/2026: a Shopee pode responder `error: ""` no
// envelope e recusar o item DENTRO dele, numa `failure_list` que
// `pushPrecoEstoque` descartava. O envio era dado como aceito, o espelho
// recebia o número novo, o produto saía da fila — e a partir daí toda rodada
// dizia "já igual" sobre um anúncio que nunca recebeu nada. Um anúncio
// travado para sempre, sem erro em lugar nenhum.
//
// A SAÍDA NÃO É CONFIAR MENOS NO ESPELHO, É PREFERIR A MEDIDA. A
// sincronização de catálogo grava em `estoque_reservado` o estoque que a
// plataforma DEVOLVEU (ver shopee/sync.ts, mercadolivre/sync.ts). Quando essa
// leitura contradiz o espelho, quem está errado é o espelho — ele é opinião
// nossa, ela é resposta da plataforma.
//
// Isto NÃO substitui consertar a leitura da resposta. As duas coisas andam
// juntas: uma impede que a mentira nasça, esta impede que ela seja eterna.

export type DecisaoEnvio = {
  enviar: boolean
  /** Frase para a linha da fila, dizendo por que envia ou por que não. */
  motivo: string
  /**
   * O espelho local diz uma coisa e a última leitura da plataforma diz outra.
   * Não impede nada sozinho; é o sinal de que um envio anterior foi dado como
   * aceito sem ter sido.
   */
  espelhoDivergente: boolean
}

export function precisaEnviar(p: {
  /** `marketplace_anuncios.estoque_externo`: o que acreditamos ter mandado. */
  estoqueExterno: number | null | undefined
  /**
   * `marketplace_anuncios.estoque_reservado`: o que a plataforma DEVOLVEU na
   * última sincronização de catálogo. Nulo quando nunca foi lida.
   */
  estoqueMedido: number | null | undefined
  /** O que a regra mandaria agora. `undefined` = a regra não mexe em estoque. */
  estoqueNovo: number | undefined
  precoEspelho: number | null | undefined
  /** `undefined` = a regra não mexe em preço. */
  precoNovo: number | null | undefined
}): DecisaoEnvio {
  const espelho = num(p.estoqueExterno)
  const medido = num(p.estoqueMedido)
  const novo = p.estoqueNovo

  const mudouEstoque = novo !== undefined && espelho !== novo
  const mudouPreco = p.precoNovo != null && num(p.precoEspelho) !== p.precoNovo

  // O espelho e a última leitura da plataforma discordam. Só interessa quando
  // há leitura: sem ela não há contradição, há ausência de informação.
  const espelhoDivergente = espelho !== null && medido !== null && espelho !== medido

  if (mudouEstoque || mudouPreco) {
    return { enviar: true, motivo: 'o canal está com número diferente', espelhoDivergente }
  }

  // Aqui o espelho diz que não há o que fazer. A pergunta passa a ser se ele
  // merece essa palavra.
  if (novo !== undefined && medido !== null && medido !== novo) {
    return {
      enviar: true,
      espelhoDivergente: true,
      motivo:
        `o espelho dizia ${espelho} mas a última leitura da plataforma trouxe ${medido} — ` +
        'um envio anterior foi dado como aceito sem ter sido, e este reenvia',
    }
  }

  return { enviar: false, motivo: 'o canal já está com o mesmo número', espelhoDivergente }
}

function num(v: number | null | undefined): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
