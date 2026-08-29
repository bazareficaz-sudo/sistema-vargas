import { avaliarPreco, precificarPorObjetivo, precificarPorRegra, type Cenario, type EconomiaResolvida } from './cenarios'
import { classificarMargem, limitePromocionalEfetivo, type Margens, type ResultadoClassificacao } from './margens'
import type { PrecoResolvido } from './precos'
import type { Regra } from './regras'

// ESTRATÉGIA ECONÔMICA DO ANÚNCIO — camada PURA, calculada, não persistida.
//
// É a composição de tudo que a Fase 1 e a Fase 2 construíram: preço efetivo,
// margem efetiva, as três margens, os três preços de referência e a
// classificação. Nada aqui é gravado: todos os campos são função de dados que
// já existem, e guardá-los seria criar uma tabela que envelhece sozinha
// quando o custo, a comissão ou o frete mudam.
//
// A REGRA QUE ESTA CAMADA OBEDECE
//
// Ela não calcula margem. Campanha propõe preço, política define limites, e
// quem faz a conta é sempre `avaliarPreco` → motor. Aqui só se compara.

export type EstadoComercial = 'normal' | 'em_promocao' | 'sem_preco'

export type FlagComercial =
  | 'promocao_terminando'
  | 'promocao_expirada'
  | 'abaixo_do_alvo'
  | 'fora_da_politica_promocional'
  | 'abaixo_do_piso'
  | 'sem_margem_para_promocao'
  | 'preco_efetivo_inconsistente'
  | 'sem_politica_promocional'

export type TipoOportunidade =
  | 'margem_para_promocao'
  | 'sem_margem_para_promocao'
  | 'promocao_terminando'
  | 'abaixo_do_piso'
  | 'fora_da_politica_promocional'
  | 'preco_efetivo_inconsistente'

export type Oportunidade = {
  tipo: TipoOportunidade
  severidade: 'critico' | 'atencao' | 'oportunidade' | 'informativo'
  titulo: string
  detalhe: string
  /** Preço sugerido pela oportunidade, quando ela aponta para um. */
  preco?: number
}

export type EstrategiaEconomicaAnuncio = {
  precoBase: number
  precoEfetivo: number
  origemEfetivo: PrecoResolvido['origemEfetivo']
  origemBase: PrecoResolvido['origemBase']

  /** A conta completa no preço que vale agora. */
  cenarioEfetivo: Cenario
  margemEfetiva: number

  /**
   * A conta no preço que a REGRA manda cobrar. Nulo quando nenhuma regra se
   * aplica. Vem junto para quem já ia chamar `precificarPorRegra` não
   * precisar repetir o cálculo.
   */
  cenarioAlvo: Cenario | null
  /** O piso de margem interveio no preço da regra? */
  margemMinimaAplicada: boolean

  /** Preço necessário para a margem alvo — é o preço que a regra manda. */
  precoAlvo: number
  /** Preço necessário para a margem promocional mínima. Nulo sem política. */
  precoPromocionalLimite: number | null
  /** Preço necessário para a margem piso. Nulo sem piso declarado. */
  precoPiso: number | null

  margens: Margens
  classificacao: ResultadoClassificacao

  regraAplicada: { id: string; nome: string; nivel: string } | null
  campanha: PrecoResolvido['campanha']
  validadeAte: string | null

  estado: EstadoComercial
  flags: FlagComercial[]
  oportunidades: Oportunidade[]
  avisos: string[]
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const pct = (v: number) => `${v.toFixed(1).replace('.', ',')}%`

/**
 * Monta a leitura comercial completa de um anúncio.
 *
 * A MARGEM ALVO É DERIVADA, e não lida de coluna nenhuma. Auditado em
 * 29/08/2026: `objetivo_valor` só é uma margem quando o objetivo é
 * `margem_liquida`; numa regra de "markup 2,3×" ele é um multiplicador. A
 * margem alvo é a margem que o preço da regra ENTREGA nesta economia — e é
 * por isso que ela sai do motor, não do banco.
 */
export function montarEstrategia(entrada: {
  economia: EconomiaResolvida
  precos: PrecoResolvido
  regra: Regra | null
  agora?: Date
}): EstrategiaEconomicaAnuncio {
  const { economia, precos, regra } = entrada
  const avisos = [...precos.avisos]
  const flags: FlagComercial[] = []
  const oportunidades: Oportunidade[] = []

  // ── O preço da regra: é ele que define a margem alvo ──
  const cenarioAlvo = regra ? precificarPorRegra(economia, regra) : null
  const margemAlvo = cenarioAlvo?.resultado.margemLiquida ?? 0
  if (cenarioAlvo) avisos.push(...cenarioAlvo.resultado.avisos)

  const margens: Margens = {
    alvo: Number(margemAlvo.toFixed(2)),
    promocionalMinima: regra?.margemPromocionalMinima ?? null,
    piso: regra?.margemMinima ?? null,
  }

  // ── Os três preços de referência, pelo mesmo motor e pelos mesmos regimes ──
  //
  // Nada de aproximação: cada um é resolvido pela fórmula fechada dentro do
  // regime que lhe corresponde, então o degrau do frete grátis e a troca de
  // faixa de comissão estão respeitados nos três.
  const precoAlvo = cenarioAlvo?.resultado.preco ?? 0
  const limitePromo = limitePromocionalEfetivo(margens)
  const naoZero = (v: number) => (v > 0 ? v : null)
  const precoPromocionalLimite = limitePromo != null
    ? naoZero(precificarPorObjetivo(economia, { tipo: 'margem_liquida', valor: limitePromo }).resultado.preco)
    : null
  const precoPiso = margens.piso != null
    ? naoZero(precificarPorObjetivo(economia, { tipo: 'margem_liquida', valor: margens.piso }).resultado.preco)
    : null

  // ── A conta no preço que vale agora ──
  const cenarioEfetivo = avaliarPreco(economia, precos.efetivo, 'preço efetivo')
  const margemEfetiva = Number(cenarioEfetivo.resultado.margemLiquida.toFixed(2))
  const classificacao = classificarMargem(margemEfetiva, margens)

  // ── Estado e bandeiras ──
  //
  // Um status principal e bandeiras, em vez de uma lista de estados
  // mutuamente exclusivos: um anúncio pode estar em promoção E terminando E
  // fora da política ao mesmo tempo, e forçar um enum único obrigaria a
  // escolher qual dessas verdades contar.
  const estado: EstadoComercial = precos.efetivo <= 0
    ? 'sem_preco'
    : precos.origemEfetivo === 'base' ? 'normal' : 'em_promocao'

  if (classificacao.classificacao !== 'alvo') flags.push('abaixo_do_alvo')
  if (classificacao.classificacao === 'bloqueado') flags.push('abaixo_do_piso')
  if (classificacao.classificacao === 'requer_aprovacao') flags.push('fora_da_politica_promocional')
  if (margens.promocionalMinima == null) flags.push('sem_politica_promocional')
  if (precos.campanha && (precos.campanha.proximidade === 'termina_hoje'
    || precos.campanha.proximidade === 'termina_em_3_dias'
    || precos.campanha.proximidade === 'termina_em_7_dias')) {
    flags.push('promocao_terminando')
  }
  if (precos.avisos.length > 0) flags.push('preco_efetivo_inconsistente')

  // Há folga para promover? Só faz sentido perguntar quando não está em
  // promoção e existe um limite promocional declarado.
  const temFolgaParaPromover = precoPromocionalLimite != null
    && precos.efetivo > precoPromocionalLimite + 0.01
  if (estado === 'normal' && precoPromocionalLimite != null && !temFolgaParaPromover) {
    flags.push('sem_margem_para_promocao')
  }

  // ── Oportunidades determinísticas ──
  if (classificacao.classificacao === 'bloqueado') {
    oportunidades.push({
      tipo: 'abaixo_do_piso', severidade: 'critico',
      titulo: 'Preço abaixo do piso econômico',
      detalhe: `O preço efetivo de ${brl(precos.efetivo)} entrega ${pct(margemEfetiva)}, abaixo do piso de ${pct(margens.piso!)}.`
        + (precoPiso != null
          ? ` O piso é atingido em ${brl(precoPiso)}.`
          : ' Com as taxas configuradas, nenhum preço atinge esse piso — reveja a regra ou as taxas do canal.'),
      preco: precoPiso ?? undefined,
    })
  } else if (classificacao.classificacao === 'requer_aprovacao') {
    oportunidades.push({
      tipo: 'fora_da_politica_promocional', severidade: 'atencao',
      titulo: 'Preço fora da política promocional',
      detalhe: classificacao.motivo,
      preco: precoPromocionalLimite ?? undefined,
    })
  }

  if (estado === 'normal' && temFolgaParaPromover) {
    const desconto = ((precos.efetivo - precoPromocionalLimite!) / precos.efetivo) * 100
    oportunidades.push({
      tipo: 'margem_para_promocao', severidade: 'oportunidade',
      titulo: 'Cabe promoção',
      detalhe: `Dá para descer até ${brl(precoPromocionalLimite!)} (${pct(desconto)} de desconto) sem sair da política promocional.`,
      preco: precoPromocionalLimite!,
    })
  }

  if (estado === 'normal' && precoPromocionalLimite != null && !temFolgaParaPromover) {
    oportunidades.push({
      tipo: 'sem_margem_para_promocao', severidade: 'informativo',
      titulo: 'Sem folga para promoção',
      detalhe: `O preço de hoje (${brl(precos.efetivo)}) já está no limite da política promocional (${brl(precoPromocionalLimite)}). Promover exigiria aprovação.`,
    })
  }

  if (precos.campanha && flags.includes('promocao_terminando')) {
    const dias = precos.campanha.diasRestantes
    const quando = precos.campanha.proximidade === 'termina_hoje'
      ? `hoje (${precos.campanha.horasRestantes}h)`
      : `em ${dias} dia(s)`
    oportunidades.push({
      tipo: 'promocao_terminando', severidade: 'atencao',
      titulo: 'Campanha terminando',
      detalhe: `A campanha "${precos.campanha.nome}" termina ${quando}. Quando ela sair, o preço volta para ${brl(precos.base)}.`,
      preco: precos.base,
    })
  }

  if (precos.avisos.length > 0) {
    oportunidades.push({
      tipo: 'preco_efetivo_inconsistente', severidade: 'atencao',
      titulo: 'Preço efetivo inconsistente',
      detalhe: precos.avisos.join(' '),
    })
  }

  return {
    precoBase: precos.base,
    precoEfetivo: precos.efetivo,
    origemEfetivo: precos.origemEfetivo,
    origemBase: precos.origemBase,
    cenarioEfetivo,
    margemEfetiva,
    cenarioAlvo,
    margemMinimaAplicada: cenarioAlvo?.margemMinimaAplicada ?? false,
    precoAlvo,
    precoPromocionalLimite,
    precoPiso,
    margens,
    classificacao,
    regraAplicada: regra ? { id: regra.id, nome: regra.nome, nivel: regra.nivel } : null,
    campanha: precos.campanha,
    validadeAte: precos.validadeAte,
    estado,
    flags,
    oportunidades,
    avisos,
  }
}

/**
 * Um cenário promocional candidato, classificado.
 *
 * É o que a tela de simulação usa e o que campanhas e atacado vão usar na
 * Fase 3: informa-se um preço (ou um desconto sobre a base) e a resposta é a
 * economia real mais o veredito da política.
 */
export type CenarioPromocional = {
  precoBase: number
  precoCandidato: number
  descontoPercentual: number
  cenario: Cenario
  classificacao: ResultadoClassificacao
  margens: Margens
  /** Falso quando a política não permite executar sem decisão humana. */
  liberado: boolean
}

export function simularCenarioPromocional(entrada: {
  economia: EconomiaResolvida
  margens: Margens
  precoBase: number
  precoCandidato?: number
  descontoPercentual?: number
}): CenarioPromocional {
  const { economia, margens, precoBase } = entrada

  // O desconto é convertido em preço UMA vez, aqui, e a partir daí só o preço
  // circula. É o mesmo cuidado do desconto duplo: percentual que viaja pelo
  // sistema acaba aplicado duas vezes.
  const precoCandidato = entrada.precoCandidato != null
    ? Number(entrada.precoCandidato)
    : Number((precoBase * (1 - (entrada.descontoPercentual ?? 0) / 100)).toFixed(2))

  const cenario = avaliarPreco(economia, precoCandidato, 'cenário promocional')
  const classificacao = classificarMargem(
    Number(cenario.resultado.margemLiquida.toFixed(2)), margens,
  )

  return {
    precoBase,
    precoCandidato,
    descontoPercentual: precoBase > 0
      ? Number((((precoBase - precoCandidato) / precoBase) * 100).toFixed(2))
      : 0,
    cenario,
    classificacao,
    margens,
    liberado: classificacao.classificacao === 'alvo' || classificacao.classificacao === 'promocional',
  }
}
