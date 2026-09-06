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

// ── OS DOIS PREÇOS, COMO ETIQUETA ───────────────────────────────────────────
//
// Pedido do gestor em 06/09/2026, depois de ver a frase no rodapé: ele não
// quer ler uma sentença, quer LER DOIS PREÇOS.
//
//     PIX / DIN            R$ 22,00
//     CARTÃO / CARTEIRA    R$ 25,02
//
// A diferença é de tempo de leitura. Com o cliente esperando, "Preços
// promocionais valem só em Dinheiro ou PIX. Fora delas, +R$ 3,02" obriga o
// vendedor a fazer uma subtração de cabeça para responder "quanto fica no
// cartão?". As duas linhas já trazem a resposta.

/** Rótulo curto de cada forma, para caber lado a lado no rodapé. */
const CURTOS: Record<string, string> = {
  dinheiro: 'DIN',
  pix: 'PIX',
  debito: 'DÉBITO',
  credito: 'CRÉDITO',
  carteira: 'CARTEIRA',
  fiado: 'FIADO',
}

/**
 * Junta as formas de um lado em um rótulo curto.
 *
 * Débito e crédito viram "CARTÃO" quando caem do MESMO lado — que é como
 * quem está no balcão fala. Quando caem em lados diferentes (a loja autoriza
 * débito mas não crédito), aparecem separados: fundir ali faria o rótulo
 * mentir sobre qual cartão dá desconto.
 */
export function rotuloCurtoDoGrupo(tipos: string[]): string {
  const temDebito = tipos.includes('debito')
  const temCredito = tipos.includes('credito')
  const juntaCartao = temDebito && temCredito

  const partes: string[] = []
  for (const t of tipos) {
    if (juntaCartao && (t === 'debito' || t === 'credito')) {
      if (!partes.includes('CARTÃO')) partes.push('CARTÃO')
      continue
    }
    partes.push(CURTOS[t] ?? t.toUpperCase())
  }
  return partes.join(' / ')
}

export type GruposDePagamento = {
  /** Formas que dão direito ao preço promocional. */
  comDesconto: string[]
  /** Todas as outras que o PDV oferece. */
  semDesconto: string[]
  rotuloComDesconto: string
  rotuloSemDesconto: string
}

/**
 * Divide as formas do PDV nos dois lados da regra.
 *
 * `todasAsFormas` vem de quem chama para o módulo não depender da lista do
 * PDV — a ordem dela é a ordem em que os rótulos aparecem, e é a mesma ordem
 * dos botões de pagamento. Ler o rodapé e olhar os botões tem que dar a mesma
 * sequência, senão o vendedor procura.
 */
export function gruposDePagamento(
  cfg: ConfigPromocaoPagamento | null | undefined,
  todasAsFormas: string[],
): GruposDePagamento | null {
  if (!cfg?.exigirFormaPagamento) return null
  const permitidas = (cfg.formasPermitidas ?? []).filter(Boolean)
  if (permitidas.length === 0) return null

  const comDesconto = todasAsFormas.filter(f => permitidas.includes(f))
  const semDesconto = todasAsFormas.filter(f => !permitidas.includes(f))
  if (comDesconto.length === 0 || semDesconto.length === 0) return null

  return {
    comDesconto,
    semDesconto,
    rotuloComDesconto: rotuloCurtoDoGrupo(comDesconto),
    rotuloSemDesconto: rotuloCurtoDoGrupo(semDesconto),
  }
}
