// AS TRÊS MARGENS E O CLASSIFICADOR ECONÔMICO — camada PURA.
//
// Este arquivo responde a uma pergunta só, e é a pergunta que toda a
// Inteligência Comercial vai fazer: **este resultado econômico pode ser
// executado?**
//
// Ele não calcula preço nem margem. Recebe a margem que o motor já apurou e
// a compara com a política. Campanha, atacado, automação e IA vão todos
// passar por aqui em vez de cada um decidir com o próprio `if`.
//
// AS TRÊS MARGENS, E POR QUE SÃO TRÊS
//
//   ALVO         quanto se quer ganhar normalmente.
//   PROMOCIONAL  até onde uma promoção pode reduzir sem pedir licença.
//   PISO         limite econômico absoluto.
//
// Piso e promocional NÃO são a mesma coisa: entre os dois existe uma faixa
// em que o negócio é economicamente possível mas está fora da política — e
// essa faixa precisa de gente decidindo, não de um sistema decidindo
// sozinho.
//
// DE ONDE CADA UMA VEM (auditado em 29/08/2026)
//
//   PISO         `precificacao_regra.margem_minima` — já era exatamente isso.
//   PROMOCIONAL  `precificacao_regra.margem_promocional_minima` — coluna nova.
//   ALVO         DERIVADA. Não existe coluna, e não deve existir: a regra
//                pode ser "markup 2,3×" ou "R$ 25 por unidade", e nesses
//                casos a margem alvo é consequência do preço que a regra
//                produz naquela economia. Guardá-la seria guardar um número
//                que envelhece sozinho quando custo, comissão ou frete mudam.

export type ClassificacaoMargem = 'alvo' | 'promocional' | 'requer_aprovacao' | 'bloqueado'

export type Margens = {
  /** Margem que o preço da regra entrega nesta economia. Sempre existe. */
  alvo: number
  /**
   * Até onde a promoção pode ir sem aprovação.
   *
   * NULA = a regra não declarou política promocional. Nesse caso a faixa
   * promocional fica VAZIA e o limite vira o próprio piso — nada é aprovado
   * automaticamente como "desconto aceitável". É o fallback seguro: antes da
   * Fase 2 o sistema não tinha esse conceito, e passar a autorizar desconto
   * que ninguém autorizou seria pior que não ter a política.
   */
  promocionalMinima: number | null
  /** Limite absoluto. NULA = a regra não declarou piso; nada é bloqueado. */
  piso: number | null
}

export type ResultadoClassificacao = {
  classificacao: ClassificacaoMargem
  margemEfetiva: number
  margens: Margens
  /** Positivo = acima do alvo. Negativo = quanto falta para alcançá-lo. */
  distanciaDoAlvo: number
  /** Quantos pontos de margem ainda cabem antes de furar o piso. */
  folgaAtePiso: number | null
  /** Quantos pontos cabem antes de sair da política promocional. */
  folgaAtePromocional: number | null
  /** Frase pronta para a tela e para o histórico. */
  motivo: string
}

/**
 * O limite promocional que vale de fato.
 *
 * Sem política declarada, o limite é o piso: a faixa promocional some em vez
 * de virar um número inventado.
 */
export function limitePromocionalEfetivo(m: Margens): number | null {
  return m.promocionalMinima ?? m.piso
}

const TOLERANCIA = 0.01 // centésimo de ponto percentual: "exatamente no limite" conta como dentro

/**
 * Classifica um resultado econômico contra a política da regra.
 *
 * Os limites são INCLUSIVOS: margem exatamente igual ao alvo é `alvo`,
 * exatamente igual ao piso é `requer_aprovacao` (e não `bloqueado`). Quem
 * está exatamente no limite cumpriu o limite.
 *
 * O PISO É CONFERIDO PRIMEIRO, e isto não é detalhe de ordem: estar abaixo do
 * limite econômico absoluto desqualifica independentemente do que o alvo diga.
 * Sem essa precedência, uma regra cujo alvo não pôde ser calculado (piso
 * inatingível com as taxas do canal, por exemplo, que faz o alvo derivado cair
 * para zero) classificaria QUALQUER margem como "meta atingida" — inclusive
 * prejuízo.
 */
export function classificarMargem(margemEfetiva: number, margens: Margens): ResultadoClassificacao {
  const promocional = limitePromocionalEfetivo(margens)
  const piso = margens.piso

  const base = {
    margemEfetiva,
    margens,
    distanciaDoAlvo: Number((margemEfetiva - margens.alvo).toFixed(2)),
    folgaAtePiso: piso != null ? Number((margemEfetiva - piso).toFixed(2)) : null,
    folgaAtePromocional: promocional != null ? Number((margemEfetiva - promocional).toFixed(2)) : null,
  }

  const pct = (v: number) => `${v.toFixed(1).replace('.', ',')}%`

  if (piso != null && margemEfetiva < piso - TOLERANCIA) {
    return {
      ...base, classificacao: 'bloqueado',
      motivo: `A margem de ${pct(margemEfetiva)} está abaixo do piso de ${pct(piso)} — economicamente proibida.`,
    }
  }

  if (margemEfetiva >= margens.alvo - TOLERANCIA) {
    return {
      ...base, classificacao: 'alvo',
      motivo: `A margem de ${pct(margemEfetiva)} alcança a meta de ${pct(margens.alvo)}.`,
    }
  }

  if (promocional != null && margemEfetiva >= promocional - TOLERANCIA) {
    return {
      ...base, classificacao: 'promocional',
      motivo: `A margem de ${pct(margemEfetiva)} está abaixo da meta de ${pct(margens.alvo)}, mas dentro da política promocional (mínimo ${pct(promocional)}).`,
    }
  }

  // Abaixo do alvo e fora da política promocional — mas ainda acima do piso,
  // ou sem piso declarado. É possível, não é automático.
  const porQue = promocional != null
    ? `abaixo da margem promocional mínima de ${pct(promocional)}`
    : 'sem política promocional declarada nesta regra'
  const eAinda = piso != null ? `, mas acima do piso de ${pct(piso)}` : ''
  return {
    ...base, classificacao: 'requer_aprovacao',
    motivo: `A margem de ${pct(margemEfetiva)} está ${porQue}${eAinda}. Economicamente possível, mas fora da política — precisa de decisão.`,
  }
}

/** Rótulos e cores, no mesmo formato que `ROTULO_SAUDE` do motor já usa. */
export const ROTULO_CLASSIFICACAO: Record<ClassificacaoMargem, { emoji: string; texto: string; cor: string }> = {
  alvo:              { emoji: '🟢', texto: 'Meta atingida',    cor: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  promocional:       { emoji: '🔵', texto: 'Promo aceitável',  cor: 'text-blue-700 bg-blue-50 border-blue-200' },
  requer_aprovacao:  { emoji: '🟡', texto: 'Requer aprovação', cor: 'text-amber-700 bg-amber-50 border-amber-200' },
  bloqueado:         { emoji: '🔴', texto: 'Abaixo do piso',   cor: 'text-red-700 bg-red-50 border-red-200' },
}

/**
 * Guardrail: este cenário comercial pode ser executado sem intervenção
 * humana?
 *
 * `alvo` e `promocional` passam. `requer_aprovacao` e `bloqueado` não — a
 * diferença entre os dois é que o primeiro admite uma decisão e o segundo
 * não deveria nem ser oferecido.
 */
export function podeExecutarSemAprovacao(c: ClassificacaoMargem): boolean {
  return c === 'alvo' || c === 'promocional'
}

export function estaBloqueado(c: ClassificacaoMargem): boolean {
  return c === 'bloqueado'
}
