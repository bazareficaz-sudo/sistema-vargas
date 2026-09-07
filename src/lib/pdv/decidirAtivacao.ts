import { hashesIguais } from './terminalToken'

// A DECISÃO DA ATIVAÇÃO, separada do banco e da rota.
//
// É a parte que precisa estar certa: um `if` errado aqui transforma o código
// de ativação em porta aberta. Fora da rota, ela é testável sem Postgres e
// sem HTTP — e é onde moram os casos que a Etapa A precisa provar (código
// expirado, usado, tentativas esgotadas, retry idempotente).

export type LinhaAtivacao = {
  id: string
  empresa_id: string
  terminal_id: string
  codigo_hash: string
  expira_em: string
  usado_em: string | null
  usado_por_hash: string | null
  tentativas: number
}

export type LinhaTerminal = {
  id: string
  empresa_id: string
  status: 'aguardando_ativacao' | 'ativo' | 'revogado'
}

export type DecisaoAtivacao =
  /** Primeira ativação: gravar o hash do segredo e marcar o código usado. */
  | { acao: 'ativar' }
  /** Retry da MESMA ativação: nada a gravar, devolver sucesso. */
  | { acao: 'ja_ativado' }
  | { acao: 'recusar'; erro: string; contarTentativa: boolean }

/**
 * O código apresentado autoriza esta ativação?
 *
 * A ordem das checagens é a ordem em que elas ficam caras de errar, e as que
 * NÃO contam tentativa vêm separadas de propósito: contar tentativa num
 * código expirado ou num terminal revogado deixaria um atacante queimar
 * ativações legítimas de terceiros só chutando.
 */
export function decidirAtivacao(params: {
  ativacao: LinhaAtivacao | null
  terminal: LinhaTerminal | null
  secretHashApresentado: string
  agora: Date
  maxTentativas: number
}): DecisaoAtivacao {
  const { ativacao, terminal, secretHashApresentado, agora, maxTentativas } = params

  // Código inexistente e código errado devolvem a MESMA mensagem: dizer qual
  // dos dois foi conta ao atacante quais códigos existem.
  if (!ativacao) {
    return { acao: 'recusar', erro: 'Código de ativação inválido ou expirado.', contarTentativa: false }
  }

  if (!terminal) {
    return { acao: 'recusar', erro: 'Terminal não encontrado.', contarTentativa: false }
  }

  if (terminal.status === 'revogado') {
    // Revogado não volta sozinho: exige nova autorização e novo código.
    return { acao: 'recusar', erro: 'Este terminal foi revogado. Peça uma nova autorização.', contarTentativa: false }
  }

  if (ativacao.tentativas >= maxTentativas) {
    return { acao: 'recusar', erro: 'Código bloqueado por excesso de tentativas. Gere um novo.', contarTentativa: false }
  }

  if (new Date(ativacao.expira_em) <= agora) {
    return { acao: 'recusar', erro: 'Código de ativação inválido ou expirado.', contarTentativa: false }
  }

  // ── IDEMPOTÊNCIA (requisito 29) ──────────────────────────────────────────
  //
  // Código já usado: só é erro se quem apresenta é OUTRO segredo. Se for o
  // mesmo, é o PDV repetindo a chamada porque a resposta se perdeu — e nesse
  // caso a resposta certa é "já está ativado", não "código usado". Sem isto,
  // um pacote perdido deixaria o terminal travado esperando código novo.
  if (ativacao.usado_em) {
    if (ativacao.usado_por_hash && hashesIguais(ativacao.usado_por_hash, secretHashApresentado)) {
      return { acao: 'ja_ativado' }
    }
    return { acao: 'recusar', erro: 'Código de ativação já utilizado.', contarTentativa: true }
  }

  return { acao: 'ativar' }
}

export type DecisaoToken =
  | { acao: 'emitir' }
  | { acao: 'recusar'; erro: string; status: number }

/**
 * A credencial apresentada vale um token?
 *
 * A EMPRESA NUNCA VEM DAQUI. Ela é lida da linha do terminal, no servidor.
 * Este módulo sequer aceita uma empresa como parâmetro — é a forma mais
 * simples de garantir o requisito 30: não há como um pedido "me dê token da
 * empresa B" ser atendido, porque não existe onde escrevê-lo.
 */
export function decidirToken(params: {
  terminal: (LinhaTerminal & { secret_hash: string | null }) | null
  secretHashApresentado: string
  empresaAtiva: boolean
}): DecisaoToken {
  const { terminal, secretHashApresentado, empresaAtiva } = params

  // Mesma mensagem para terminal inexistente e credencial errada.
  if (!terminal || !terminal.secret_hash) {
    return { acao: 'recusar', erro: 'Credencial inválida.', status: 401 }
  }
  if (!hashesIguais(terminal.secret_hash, secretHashApresentado)) {
    return { acao: 'recusar', erro: 'Credencial inválida.', status: 401 }
  }
  if (terminal.status === 'revogado') {
    // Aqui a mensagem PODE ser específica: quem chegou até aqui provou posse
    // da credencial, então já é o dono do terminal — e precisa saber por que
    // parou de funcionar.
    return { acao: 'recusar', erro: 'Terminal revogado.', status: 403 }
  }
  if (terminal.status !== 'ativo') {
    return { acao: 'recusar', erro: 'Terminal ainda não foi ativado.', status: 403 }
  }
  if (!empresaAtiva) {
    return { acao: 'recusar', erro: 'A empresa deste terminal está inativa.', status: 403 }
  }

  return { acao: 'emitir' }
}
