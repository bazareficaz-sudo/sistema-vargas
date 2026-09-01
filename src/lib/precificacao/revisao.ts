import type { Cenario } from './cenarios'
import type { OrigemFrete } from './contexto'

// REVISÃO DE DECISÃO JÁ TOMADA — o preço aplicado ainda vale?
//
// POR QUE ISTO EXISTE. O ciclo de precificação era aberto: o sistema
// recomendava, alguém aplicava, gravava em `precificacao_historico` e nada
// nunca voltava para conferir. Enquanto a premissa não mudasse, tudo bem.
//
// Ela mudou. Até 30/08/2026 o frete do Mercado Livre abaixo de R$ 79 era uma
// SUPOSIÇÃO gravada como se fosse medição — zero. O frete real naquela faixa
// é de R$ 6,85 a R$ 10,23. Em 17 anúncios do ML o preço foi aplicado com
// margem registrada de 11,66% sobre preço médio de R$ 32,08. Com o frete real,
// esses ~25 pontos percentuais somem: o que foi decidido como lucro pode ser
// prejuízo, e está no ar desde julho.
//
// TRÊS NÚMEROS, TRÊS SIGNIFICADOS. É a decomposição que faz esta revisão valer
// alguma coisa, e ela precisa dos três — dois não bastam:
//
//   registrada  custo de então  ·  premissas de então   ← o que se acreditou
//   corrigida   custo de então  ·  premissas de HOJE    ← o que era verdade
//   atual       custo de hoje   ·  premissas de hoje    ← o que vale agora
//
// `registrada − corrigida` é o TAMANHO DO ENGANO: o quanto a informação errada
// distorceu a decisão, isolado de qualquer coisa que tenha mudado depois.
// `corrigida − atual` é o que o mundo mudou desde então (custo subiu, comissão
// mudou de faixa). Somar os dois num número só esconderia justamente a
// pergunta que esta tela existe para responder: "eu decidi errado, ou o mundo
// mudou?" — que pedem ações diferentes.
//
// O QUE ESTE MÓDULO NÃO FAZ: reescrever o histórico. `precificacao_historico`
// é o registro do que foi decidido E COM QUE INFORMAÇÃO. Corrigir a margem
// gravada apagaria a evidência de que a decisão foi tomada no escuro — mesma
// razão pela qual `contas_receber.cliente_nome` não é reescrito na unificação
// de clientes.

export type Veredito =
  /** A margem registrada se sustenta com o que se sabe hoje. */
  | 'confirmada'
  /** O preço continua acima do piso, mas rende bem menos do que foi registrado. */
  | 'envelhecida'
  /** Com a informação de hoje, este preço está abaixo do piso da política. */
  | 'abaixo_do_piso'
  /** Com a informação de hoje, este preço dá prejuízo. */
  | 'prejuizo'
  /** Falta evidência para revisar — e isso NÃO é o mesmo que estar certo. */
  | 'nao_verificavel'

export type RevisaoDecisao = {
  veredito: Veredito
  /** Margem líquida gravada na época, em %. */
  margemRegistrada: number
  /** A mesma decisão, recalculada com as premissas de hoje. Null se não deu. */
  margemCorrigida: number | null
  /** O preço aplicado avaliado com o custo de hoje. Null se não deu. */
  margemAtual: number | null
  /** `registrada − corrigida`: quanto a informação errada distorceu a decisão. */
  distorcaoDaPremissa: number | null
  /** Dinheiro por unidade vendida que a decisão perdeu, se negativo. */
  lucroCorrigido: number | null
  /**
   * Por que a revisão vale (ou não). Cita a fonte, não o resultado — quem lê
   * precisa saber se está olhando medição ou suposição.
   */
  fundamento: string
  /** Só preenchido quando o veredito é `nao_verificavel`. */
  impedimento?: string
}

/** Origens que significam "o Mercado Livre respondeu", não "assumimos". */
function freteFoiMedido(origem: OrigemFrete): boolean {
  return origem === 'api_ml' || origem === 'api_ml_cache'
}

export function revisarDecisao(entrada: {
  /** O que ficou gravado quando o preço foi aplicado. */
  margemRegistrada: number
  precoAplicado: number
  /** A mesma decisão recalculada hoje, com o CUSTO DA ÉPOCA. */
  comPremissasDeHoje: Cenario | null
  /** O preço aplicado avaliado com o custo de hoje. */
  comCustoDeHoje: Cenario | null
  origemFrete: OrigemFrete
  /** Piso da política em %, quando a regra declara um. */
  piso: number | null
  /** A plataforma mede frete? A Shopee não tem sonda como o ML tem. */
  plataformaTemFreteMedido: boolean
}): RevisaoDecisao {
  const { margemRegistrada, comPremissasDeHoje, comCustoDeHoje, origemFrete, piso } = entrada

  const base = {
    margemRegistrada,
    margemCorrigida: comPremissasDeHoje?.resultado.margemLiquida ?? null,
    margemAtual: comCustoDeHoje?.resultado.margemLiquida ?? null,
    lucroCorrigido: comPremissasDeHoje?.resultado.lucro ?? null,
    distorcaoDaPremissa: comPremissasDeHoje
      ? Number((margemRegistrada - comPremissasDeHoje.resultado.margemLiquida).toFixed(2))
      : null,
  }

  if (!comPremissasDeHoje?.valido) {
    return {
      ...base,
      veredito: 'nao_verificavel',
      fundamento: 'O motor não conseguiu fechar a conta para este anúncio com os dados de hoje.',
      impedimento: 'Sem custo ou sem configuração de canal — a decisão antiga fica sem contraprova.',
    }
  }

  // A REVISÃO SÓ VALE SE O NÚMERO NOVO FOR MELHOR QUE O ANTIGO.
  //
  // Revisar um frete suposto contra outro frete suposto não descobre nada: os
  // dois saem da mesma configuração, e o resultado seria "não mudou nada" —
  // uma confirmação falsa, que é pior que não revisar. É o mesmo cuidado que
  // fez `origemFrete` existir.
  if (entrada.plataformaTemFreteMedido && !freteFoiMedido(origemFrete)) {
    return {
      ...base,
      veredito: 'nao_verificavel',
      fundamento: 'O frete deste anúncio continua vindo da configuração do canal, não de medição.',
      impedimento: 'Sem peso e dimensões o Mercado Livre não responde o frete. Preencha no cadastro ou no anúncio para poder revisar.',
    }
  }

  const corrigida = comPremissasDeHoje.resultado.margemLiquida
  const lucro = comPremissasDeHoje.resultado.lucro
  const distorcao = base.distorcaoDaPremissa ?? 0

  const fonteFrete = freteFoiMedido(origemFrete)
    ? 'frete medido na API do Mercado Livre'
    : entrada.plataformaTemFreteMedido
      ? 'frete da configuração do canal'
      : 'frete conforme configurado para a plataforma (não há medição disponível)'

  if (lucro < 0) {
    return {
      ...base, veredito: 'prejuizo',
      fundamento: `Com ${fonteFrete}, este preço dá prejuízo de R$ ${Math.abs(lucro).toFixed(2)} por unidade. Foi aplicado como ${margemRegistrada.toFixed(1)}% de margem.`,
    }
  }

  if (piso != null && corrigida < piso) {
    return {
      ...base, veredito: 'abaixo_do_piso',
      fundamento: `Com ${fonteFrete}, a margem real é ${corrigida.toFixed(1)}% — abaixo do piso de ${piso.toFixed(1)}% da política. Foi aplicado como ${margemRegistrada.toFixed(1)}%.`,
    }
  }

  // Um ponto percentual é ruído de arredondamento e de mudança de faixa de
  // comissão; não vale acordar ninguém por isso.
  if (distorcao > 1) {
    return {
      ...base, veredito: 'envelhecida',
      fundamento: `A margem registrada era ${margemRegistrada.toFixed(1)}%; com ${fonteFrete} são ${corrigida.toFixed(1)}%. O preço se sustenta, mas rende ${distorcao.toFixed(1)} pontos a menos do que se acreditava.`,
    }
  }

  return {
    ...base, veredito: 'confirmada',
    fundamento: `Com ${fonteFrete}, a margem se confirma em ${corrigida.toFixed(1)}%.`,
  }
}

/**
 * A ordem da fila de revisão.
 *
 * Prejuízo primeiro, e dentro dele o que perde mais dinheiro por unidade —
 * não por data nem por nome. Uma fila ordenada por data faz o operador gastar
 * a atenção dele no primeiro item em vez de no pior.
 *
 * `nao_verificavel` vai para o FIM, e não é desprezo: são os que precisam de
 * cadastro antes de precisarem de decisão. Misturá-los com os confirmados
 * esconderia que existe trabalho pendente ali.
 */
export const PESO_VEREDITO: Record<Veredito, number> = {
  prejuizo: 0,
  abaixo_do_piso: 1,
  envelhecida: 2,
  confirmada: 3,
  nao_verificavel: 4,
}

export function ordenarFila<T extends { revisao: RevisaoDecisao }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const pa = PESO_VEREDITO[a.revisao.veredito]
    const pb = PESO_VEREDITO[b.revisao.veredito]
    if (pa !== pb) return pa - pb
    // Dentro do mesmo veredito: quem perde mais dinheiro por unidade primeiro.
    return (a.revisao.lucroCorrigido ?? 0) - (b.revisao.lucroCorrigido ?? 0)
  })
}

export const ROTULO_VEREDITO: Record<Veredito, { texto: string; emoji: string }> = {
  prejuizo: { texto: 'Dá prejuízo hoje', emoji: '🔴' },
  abaixo_do_piso: { texto: 'Abaixo do piso da política', emoji: '🟠' },
  envelhecida: { texto: 'Rende menos do que foi registrado', emoji: '🟡' },
  confirmada: { texto: 'Confirmada', emoji: '🟢' },
  nao_verificavel: { texto: 'Sem evidência para revisar', emoji: '⚪' },
}
