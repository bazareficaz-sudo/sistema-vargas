import { calcular, saudeDaMargem } from './motor'
import { aplicarRegra, type Regra } from './regras'
import type { FaixasSaude } from './config'
import type { ArredondamentoPreco, ConfigTaxas, FaixaFrete, Objetivo, Resultado, SaudePreco } from './tipos'

// Cenários econômicos — camada PURA entre o contexto resolvido e o motor.
//
// POR QUE EXISTE
//
// O motor sabe responder duas perguntas opostas com a mesma matemática:
//
//   "que preço me dá esta margem?"   → objetivo margem/markup/lucro
//   "esta margem sai deste preço?"   → objetivo { tipo: 'preco' }
//
// A segunda já existia, mas nunca teve nome nem porta de entrada: cada tela
// montava a chamada por conta própria. É ela que a Inteligência Comercial vai
// usar o tempo todo — campanha, preço por quantidade, competitividade e IA
// PROPÕEM um preço, e alguém precisa dizer quanto sobra.
//
// Aqui essa porta tem nome: `avaliarPreco`. Campanha não calcula margem.
// Atacado não calcula margem. IA não calcula margem. Todos passam por aqui.
//
// Este arquivo não faz I/O de propósito: recebe a economia já resolvida por
// `contexto.ts` e devolve números. É testável sem banco e sem rede.

/**
 * Tudo que o motor precisa saber sobre a economia de um item num canal, já
 * resolvido — comissão real, frete real, custo apurado.
 *
 * Quem monta isto é `contexto.ts`. Quem consome são as funções abaixo. O
 * motor continua sem saber que banco existe.
 */
export type EconomiaResolvida = {
  cfg: ConfigTaxas & { faixasSaude: FaixasSaude }
  custo: number
  pesoKg: number | null
  freteFaixas: FaixaFrete[] | null
}

export type Cenario = {
  rotulo: string
  resultado: Resultado
  saude: SaudePreco
  /** Lucro ÷ custo, em %. É a base das regras de "x% sobre o custo". */
  lucroSobreCusto: number
  /** Falso quando o motor não conseguiu fechar a conta (preço zero). */
  valido: boolean
}

function montar(rotulo: string, e: EconomiaResolvida, r: Resultado): Cenario {
  return {
    rotulo,
    resultado: r,
    saude: saudeDaMargem(r.margemLiquida, e.cfg.faixasSaude),
    lucroSobreCusto: Number(r.roi.toFixed(2)),
    valido: r.preco > 0,
  }
}

/**
 * "Se eu vender por ESTE preço, qual é o resultado econômico?"
 *
 * Nenhum arredondamento é aplicado: o preço candidato veio de fora (uma
 * campanha do marketplace, uma faixa de atacado, uma sugestão de
 * competitividade) e mexer nele descaracterizaria a pergunta.
 */
export function avaliarPreco(e: EconomiaResolvida, preco: number, rotulo = 'preço informado'): Cenario {
  const r = calcular({
    cfg: e.cfg, custoProduto: e.custo, pesoKg: e.pesoKg, freteFaixas: e.freteFaixas,
    objetivo: { tipo: 'preco', valor: preco },
  })
  return montar(rotulo, e, r)
}

/** "Que preço atinge este objetivo?" — sem passar por regra cadastrada. */
export function precificarPorObjetivo(
  e: EconomiaResolvida,
  objetivo: Objetivo,
  opcoes: { arredondamento?: ArredondamentoPreco; rotulo?: string } = {},
): Cenario {
  const r = calcular({
    cfg: e.cfg, custoProduto: e.custo, pesoKg: e.pesoKg, freteFaixas: e.freteFaixas,
    objetivo, arredondamento: opcoes.arredondamento,
  })
  return montar(opcoes.rotulo ?? 'objetivo informado', e, r)
}

/** "Que preço a regra que venceu manda cobrar?" — com o piso de margem. */
export function precificarPorRegra(
  e: EconomiaResolvida,
  regra: Regra,
  rotulo = 'regra aplicada',
): Cenario & { margemMinimaAplicada: boolean } {
  const r = aplicarRegra({
    cfg: e.cfg, custoProduto: e.custo, pesoKg: e.pesoKg, freteFaixas: e.freteFaixas, regra,
  })
  return { ...montar(rotulo, e, r), margemMinimaAplicada: r.margemMinimaAplicada }
}

/**
 * Vários preços candidatos de uma vez, na mesma economia.
 *
 * É a forma que a Fase 2 vai usar para comparar preço base × preço de
 * campanha × faixas de atacado sem que nenhuma dessas camadas precise refazer
 * conta nenhuma.
 */
export function avaliarPrecos(e: EconomiaResolvida, precos: { rotulo: string; preco: number }[]): Cenario[] {
  return precos.map(p => avaliarPreco(e, p.preco, p.rotulo))
}
