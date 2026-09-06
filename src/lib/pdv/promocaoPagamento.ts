// PROMOÇÃO CONDICIONADA À FORMA DE PAGAMENTO.
//
// "Este preço é só no Pix" é prática corrente no balcão, e existe por um
// motivo concreto: cartão custa taxa da adquirente, Pix e dinheiro não. Quem
// anuncia o preço promocional para todo mundo está pagando a taxa do próprio
// desconto.
//
// O QUE ESTE MÓDULO DECIDE, e o que ele deliberadamente não decide:
//
//   decide   se o preço promocional vale para as formas de pagamento
//            escolhidas nesta venda;
//   não decide  qual preço cobrar. Isso continua em `produtos/promocao.ts`,
//            que já sabe de vigência, faixa de quantidade e devolução. Aqui
//            só se responde "a promoção está autorizada?" e a resposta entra
//            lá como um parâmetro.
//
// PAGAMENTO DIVIDIDO: o PDV aceita mais de uma forma na mesma venda. A regra
// é que TODAS precisam estar autorizadas. Metade em Pix e metade em crédito
// não cumpre "só no Pix" — e ratear o desconto proporcionalmente seria uma
// conta que ninguém consegue conferir no balcão, com o cliente esperando.

import { rotuloDaForma } from './formasPagamento'

export type ConfigPromocaoPagamento = {
  /** Interruptor da empresa. Desligado, tudo se comporta como antes. */
  exigirFormaPagamento: boolean
  /** Formas que autorizam o preço promocional, ex.: ['pix', 'dinheiro']. */
  formasPermitidas: string[]
}

export const CONFIG_PADRAO: ConfigPromocaoPagamento = {
  exigirFormaPagamento: false,
  formasPermitidas: [],
}

export type VereditoPromocao = {
  /** O preço promocional vale para esta combinação de pagamento. */
  vale: boolean
  /** Frase para o vendedor. Nula quando não há restrição a comunicar. */
  motivo: string | null
  /** A restrição existe (mesmo que esteja sendo cumprida agora). */
  restricaoAtiva: boolean
}

/**
 * A promoção vale para as formas de pagamento escolhidas?
 *
 * `tiposEscolhidos` vazio significa que o vendedor ainda não escolheu. Nesse
 * caso a promoção VALE: é o preço anunciado na etiqueta, e é o que o cliente
 * precisa ver enquanto os itens entram. A perda do desconto acontece — e é
 * comunicada — no momento em que uma forma não autorizada é escolhida.
 */
export function promocaoValeNasFormas(
  cfg: ConfigPromocaoPagamento | null | undefined,
  tiposEscolhidos: string[],
): VereditoPromocao {
  const exigir = !!cfg?.exigirFormaPagamento
  const permitidas = (cfg?.formasPermitidas ?? []).filter(Boolean)

  if (!exigir) return { vale: true, motivo: null, restricaoAtiva: false }

  // LISTA VAZIA COM O INTERRUPTOR LIGADO não pode matar toda promoção em
  // silêncio: seria uma configuração pela metade tirando desconto que o
  // cliente já viu na etiqueta. A tela de configuração recusa salvar assim;
  // aqui a defesa existe para o caso de a linha chegar torta de outro jeito.
  if (permitidas.length === 0) return { vale: true, motivo: null, restricaoAtiva: false }

  const escolhidas = tiposEscolhidos.filter(Boolean)
  if (escolhidas.length === 0) {
    return { vale: true, motivo: null, restricaoAtiva: true }
  }

  const naoAutorizadas = [...new Set(escolhidas.filter(t => !permitidas.includes(t)))]
  if (naoAutorizadas.length === 0) {
    return { vale: true, motivo: null, restricaoAtiva: true }
  }

  // Duas frases inteiras, e não uma com sufixo colado: a primeira tentativa
  // montava "não dá" + "ão" e produzia "não dáão". Concordância não é
  // concatenação.
  const motivo = naoAutorizadas.length === 1
    ? `Preço promocional só em ${listar(permitidas)}. `
      + `${rotuloDaForma(naoAutorizadas[0])} não dá direito ao desconto.`
    : `Preço promocional só em ${listar(permitidas)}. `
      + `${listarE(naoAutorizadas)} não dão direito ao desconto.`

  return { vale: false, restricaoAtiva: true, motivo }
}

/** "PIX ou Dinheiro" — a lista de alternativas, para o que É permitido. */
export function listar(tipos: string[]): string {
  return juntar(tipos, 'ou')
}

/** "Crédito e Débito" — a lista de fatos, para o que NÃO é permitido. */
export function listarE(tipos: string[]): string {
  return juntar(tipos, 'e')
}

function juntar(tipos: string[], conector: string): string {
  const nomes = tipos.map(rotuloDaForma)
  if (nomes.length === 0) return ''
  if (nomes.length === 1) return nomes[0]
  return `${nomes.slice(0, -1).join(', ')} ${conector} ${nomes[nomes.length - 1]}`
}

/** A frase curta do aviso permanente no carrinho. */
export function avisoDaRestricao(cfg: ConfigPromocaoPagamento | null | undefined): string | null {
  if (!cfg?.exigirFormaPagamento) return null
  const permitidas = (cfg.formasPermitidas ?? []).filter(Boolean)
  if (permitidas.length === 0) return null
  return `Preços promocionais valem só em ${listar(permitidas)}.`
}
