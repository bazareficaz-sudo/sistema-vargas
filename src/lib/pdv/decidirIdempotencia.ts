// IDEMPOTÊNCIA — a decisão, sem banco.
//
// O problema que ela resolve não é o cliente clicar duas vezes. É este:
//
//   PDV envia → servidor executa → resposta se perde na volta → PDV repete
//
// Do lado do PDV os dois casos são idênticos: silêncio. Se repetir executa de
// novo, uma venda vira duas. A chave de idempotência é o que permite ao
// servidor reconhecer "isto eu já fiz" e devolver o MESMO resultado de antes,
// em vez de fazer de novo ou recusar.
//
// A chave é gerada pelo cliente porque só ele sabe que a segunda chamada é a
// mesma intenção da primeira. O servidor não teria como adivinhar.

export type LinhaOperacao = {
  status: 'em_andamento' | 'sucesso' | 'erro'
  resposta: unknown
  criado_em: string
}

export type DecisaoIdempotencia =
  /** Nunca vi esta chave: executar e registrar. */
  | { acao: 'executar' }
  /** Já executei com sucesso: devolver a resposta guardada, sem repetir. */
  | { acao: 'repetir_resposta'; resposta: unknown }
  /** Tentei e falhou: pode tentar de novo. */
  | { acao: 'reexecutar' }
  /** Uma chamada igual está em voo agora. */
  | { acao: 'em_voo'; erro: string }

/** Janela em que uma operação 'em_andamento' é considerada travada, não em voo. */
export const SEGUNDOS_ATE_DESTRAVAR = 60

/**
 * `existente` é a linha que a chave já tem, ou `null` se a chave é nova.
 *
 * O caso 'em_andamento' precisa de cuidado: ele normalmente significa "outra
 * requisição igual está acontecendo agora", e a resposta certa é recusar. Mas
 * se o processo morreu no meio, a linha fica 'em_andamento' para sempre e a
 * chave nunca mais funciona — o PDV ficaria travado repetindo uma operação
 * que não pode nem executar nem desistir. Por isso a janela: passado um
 * minuto sem conclusão, tratamos como abandonada e deixamos reexecutar.
 *
 * Um minuto é folgado para as operações desta fase e curto para o operador.
 * Quando `vendas` migrar, este número precisa ser revisto junto com o tempo
 * real da transação.
 */
export function decidirIdempotencia(
  existente: LinhaOperacao | null,
  agora: Date = new Date(),
): DecisaoIdempotencia {
  if (!existente) return { acao: 'executar' }

  if (existente.status === 'sucesso') {
    return { acao: 'repetir_resposta', resposta: existente.resposta }
  }

  if (existente.status === 'erro') return { acao: 'reexecutar' }

  const idadeSegundos = (agora.getTime() - new Date(existente.criado_em).getTime()) / 1000
  if (idadeSegundos > SEGUNDOS_ATE_DESTRAVAR) return { acao: 'reexecutar' }

  return {
    acao: 'em_voo',
    erro: 'Uma requisição igual está em andamento. Tente de novo em instantes.',
  }
}

/**
 * A chave é aceitável?
 *
 * Ela entra num índice único junto com terminal e operação, então não precisa
 * ser global nem imprevisível — precisa ser estável entre as tentativas da
 * MESMA intenção. Um UUID gerado pelo PDV na hora de criar a operação serve.
 *
 * O limite de tamanho não é frescura: sem ele, um cliente com defeito
 * escreveria megabytes num índice.
 */
export function chaveIdempotenciaValida(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length >= 8 && v.trim().length <= 200
    && /^[A-Za-z0-9._:-]+$/.test(v.trim())
}
