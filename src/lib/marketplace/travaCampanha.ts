import type { Cenario } from '@/lib/precificacao/cenarios'

// A TRAVA: o que NÃO pode ir para uma campanha.
//
// Preço promocional é preço no ar. A diferença entre errar aqui e errar no
// recálculo é que a campanha tem prazo — a "Bota Fora" vai até 31/10, e um
// item que entra com margem negativa fica vendendo no prejuízo por dois meses
// antes de alguém somar.
//
// POR QUE UMA TRAVA EXPLÍCITA, e não só mostrar a margem na tela: mostrar
// depende de alguém olhar. Esta semana já produziu três casos em que o número
// estava na tela e a decisão foi tomada sem ele — a Tomada Externa a R$ 29,63
// com margem de 10% é um deles, e teria sido -31% se o custo do cadastro
// estivesse certo.

export type MotivoBloqueio =
  | 'sem_economia'
  | 'prejuizo'
  | 'abaixo_do_piso'
  | 'preco_invalido'
  | 'acima_do_normal'

export type Veredito = {
  /** Pode enviar sem confirmação extra. */
  liberado: boolean
  /** Impede o envio, mesmo com confirmação. */
  bloqueado: boolean
  motivo?: MotivoBloqueio
  /** Frase para a tela, dizendo o número e a consequência. */
  explicacao?: string
}

/**
 * Avalia um preço promocional antes de mandar para a Shopee.
 *
 * TRÊS NÍVEIS, e a diferença entre eles é quem decide:
 *
 *   liberado                  passa direto
 *   bloqueado = false, mas    passa com confirmação explícita de quem opera —
 *     liberado = false        é uma decisão comercial legítima (queima de
 *                             estoque parado, por exemplo)
 *   bloqueado = true          não passa. Só quando o sistema não sabe calcular
 *                             ou o preço é inválido: mandar às cegas para uma
 *                             campanha com prazo é o pior dos casos.
 */
export function avaliarParaCampanha(params: {
  precoPromocional: number
  /** O cenário do preço promocional, do motor. Nulo = não deu para calcular. */
  cenario: Cenario | null
  /** Margem mínima da regra do canal, quando houver. Em % sobre o preço. */
  pisoMargem?: number | null
  /** Preço normal do anúncio, para pegar promoção que sobe o preço. */
  precoNormal?: number | null
}): Veredito {
  const preco = Number(params.precoPromocional)
  if (!Number.isFinite(preco) || preco <= 0) {
    return { liberado: false, bloqueado: true, motivo: 'preco_invalido',
      explicacao: 'Preço promocional precisa ser maior que zero.' }
  }

  // PROMOÇÃO QUE SOBE O PREÇO é quase sempre engano de digitação, e a Shopee
  // aceitaria — ela não sabe qual é o seu preço "normal".
  if (params.precoNormal && preco >= params.precoNormal) {
    return { liberado: false, bloqueado: true, motivo: 'acima_do_normal',
      explicacao: `O preço promocional (${brl(preco)}) não é menor que o normal (${brl(params.precoNormal)}).` }
  }

  if (!params.cenario) {
    // SEM CONTA NÃO PASSA. É o oposto do que a tela faz (mostrar "não
    // calculável" e seguir): aqui o preço vai ao ar com prazo, e enviar sem
    // saber a margem é apostar por dois meses.
    return { liberado: false, bloqueado: true, motivo: 'sem_economia',
      explicacao: 'Sem custo cadastrado ou sem produto vinculado, não dá para saber a margem — e este preço fica no ar até o fim da campanha.' }
  }

  const margem = params.cenario.resultado.margemLiquida
  const lucro = params.cenario.resultado.lucro

  if (margem < 0) {
    return { liberado: false, bloqueado: false, motivo: 'prejuizo',
      explicacao: `A ${brl(preco)} este item dá PREJUÍZO de ${brl(Math.abs(lucro))} por unidade (margem ${margem.toFixed(1)}%).` }
  }

  const piso = params.pisoMargem
  if (piso != null && margem < piso) {
    return { liberado: false, bloqueado: false, motivo: 'abaixo_do_piso',
      explicacao: `Margem de ${margem.toFixed(1)}% fica abaixo do piso de ${piso}% da regra do canal (lucro de ${brl(lucro)} por unidade).` }
  }

  return { liberado: true, bloqueado: false }
}

function brl(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Resume um lote para a tela decidir o que pedir ao operador. */
export function resumirVeredito(vereditos: Veredito[]) {
  return {
    liberados: vereditos.filter(v => v.liberado).length,
    exigemConfirmacao: vereditos.filter(v => !v.liberado && !v.bloqueado).length,
    bloqueados: vereditos.filter(v => v.bloqueado).length,
  }
}
