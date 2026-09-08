// SAÚDE DO TERMINAL — a diferença entre "ativado" e "vivo".
//
// A 0.6A tropeçou exatamente aqui: cinco terminais apareciam ativados, com
// identidade e rota nova ligada, e o painel não sabia dizer se algum deles
// estava sequer ligado. Passamos quatro rodadas sem conseguir separar "não
// reiniciou" de "quebrou", porque os dois produziam a mesma coisa — nada.
//
// Este módulo existe para que essa pergunta tenha resposta, e para que a
// resposta seja derivada de um sinal MEDIDO, nunca suposto.

/** De quanto em quanto tempo o PDV bate. */
export const INTERVALO_HEARTBEAT_MS = 5 * 60 * 1000

/**
 * Quantas batidas podem faltar antes de chamar de OFFLINE.
 *
 * Três, e não uma: um terminal de balcão perde rede por alguns minutos com
 * frequência banal — Wi-Fi, roteador, provedor. Marcar OFFLINE na primeira
 * falha faria o painel piscar, e um painel que pisca deixa de ser lido. O
 * preço é descobrir uma queda real até 15 minutos depois, o que é aceitável
 * para o que este número decide.
 */
export const BATIDAS_ATE_OFFLINE = 3

export const TOLERANCIA_OFFLINE_MS = INTERVALO_HEARTBEAT_MS * BATIDAS_ATE_OFFLINE

export type LinhaSaude = {
  status: 'aguardando_ativacao' | 'ativo' | 'revogado'
  versao_pdv: string | null
  usar_rotas_novas: boolean | null
  ativado_em: string | null
  ultima_autenticacao_em: string | null
  ultimo_heartbeat_em: string | null
}

export type Presenca = 'online' | 'offline' | 'nunca_bateu'

export type SaudeTerminal = {
  presenca: Presenca
  /** Já provou que consegue autenticar depois da ativação? */
  autenticado: boolean
  /** Ativado, mas ainda sem prova de autenticação pós-reinício. */
  validacaoPendente: boolean
  minutosSemBater: number | null
  versao: string | null
  rotaNova: boolean
}

function minutosDesde(iso: string | null, agora: Date): number | null {
  if (!iso) return null
  return Math.floor((agora.getTime() - new Date(iso).getTime()) / 60000)
}

/**
 * O estado de um terminal, derivado do que ele fez — não do que está escrito
 * na linha dele.
 *
 * `nunca_bateu` é um terceiro estado de propósito, separado de `offline`.
 * Confundir os dois esconderia justamente o caso que motivou este módulo: um
 * terminal ativado que nunca deu sinal de vida não é "um terminal offline",
 * é um terminal que nunca provou estar funcionando.
 */
export function saudeDoTerminal(t: LinhaSaude, agora: Date = new Date()): SaudeTerminal {
  const minutosSemBater = minutosDesde(t.ultimo_heartbeat_em, agora)

  const presenca: Presenca =
    t.ultimo_heartbeat_em === null ? 'nunca_bateu'
    : (agora.getTime() - new Date(t.ultimo_heartbeat_em).getTime()) <= TOLERANCIA_OFFLINE_MS ? 'online'
    : 'offline'

  const autenticado = t.ultima_autenticacao_em !== null

  return {
    presenca,
    autenticado,
    // Ativado e sem nenhuma autenticação posterior: é o estado do
    // `Escritorio Silvano` em 08/09 — identidade gravada, reinício ainda não
    // exercido. Merece rótulo próprio para não ser lido como falha.
    validacaoPendente: t.status === 'ativo' && !autenticado,
    minutosSemBater,
    versao: t.versao_pdv,
    rotaNova: t.usar_rotas_novas === true,
  }
}

/** Frase curta para a tela, sem inventar certeza que o dado não tem. */
export function rotuloDePresenca(s: SaudeTerminal): string {
  if (s.presenca === 'nunca_bateu') return 'nunca deu sinal'
  if (s.presenca === 'online') return 'online'
  const m = s.minutosSemBater ?? 0
  if (m < 120) return `offline há ${m} min`
  const h = Math.floor(m / 60)
  return h < 48 ? `offline há ${h} h` : `offline há ${Math.floor(h / 24)} dias`
}
