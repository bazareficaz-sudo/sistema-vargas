import type { ClaimsTerminal } from './terminalToken'

// A DECISÃO DE DEIXAR PASSAR, separada do banco e do HTTP.
//
// Um token válido responde "quem assinou isto fomos nós". Não responde se o
// terminal ainda existe, se continua ativo, se não foi revogado ontem, se a
// empresa dele ainda opera, nem se ele foi liberado para a rota nova. Essas
// cinco perguntas são de estado, e estado muda depois que o token foi
// assinado — é por isso que elas são refeitas a cada requisição em vez de
// ficarem congeladas dentro do JWT.

export type LinhaTerminalAcesso = {
  id: string
  empresa_id: string
  status: 'aguardando_ativacao' | 'ativo' | 'revogado'
  nome: string | null
  versao_pdv: string | null
  usar_rotas_novas: boolean | null
  /** Mapa operacao -> bool. Ausente ou false = caminho legado. */
  rotas_habilitadas?: Record<string, boolean> | null
}

export type ContextoTerminal = {
  terminal_id: string
  empresa_id: string
  tenant_id: string | null
  nome: string | null
  status: 'ativo'
  versao_pdv: string | null
  usar_rotas_novas: boolean
  claims: ClaimsTerminal
}

export type MotivoRecusa =
  | 'sem_token' | 'token_invalido' | 'token_expirado'
  | 'terminal_desconhecido' | 'terminal_revogado' | 'terminal_inativo'
  | 'empresa_inativa' | 'empresa_divergente' | 'rota_desligada'

export type Acesso =
  | { ok: true; contexto: ContextoTerminal }
  | { ok: false; motivo: MotivoRecusa; erro: string; status: number }

/**
 * O token assinado, mais o estado atual do banco, autorizam esta requisição?
 *
 * `exigirFlag` distingue as duas famílias de rota: as que existem só atrás do
 * interruptor de rollout (as operações migradas) e as que valem para qualquer
 * terminal ativo. Um terminal com a flag desligada não é um erro do cliente —
 * é um terminal que ainda não foi escolhido para a rota nova, e a resposta
 * precisa deixar isso claro para o PDV cair no caminho legado sem alarde.
 */
export function decidirAcesso(params: {
  claims: ClaimsTerminal | null
  terminal: LinhaTerminalAcesso | null
  tenantId: string | null
  empresaAtiva: boolean
  exigirFlag: boolean
  /**
   * Qual operação está sendo pedida. Quando informada, o interruptor
   * consultado é `rotas_habilitadas[operacao]` — granular, uma operação de
   * cada vez. Quando ausente, cai no booleano antigo `usar_rotas_novas`, que
   * vale só para `impressao.publicar_url`, já em produção.
   *
   * Sem essa separação, ligar `faltas` no Caixa ligaria junto qualquer rota
   * futura, e o rollout deixaria de ser incremental no momento exato em que
   * passa a importar que ele seja.
   */
  operacao?: string
}): Acesso {
  const { claims, terminal, tenantId, empresaAtiva, exigirFlag, operacao } = params

  if (!claims) {
    return { ok: false, motivo: 'token_invalido', erro: 'Credencial inválida.', status: 401 }
  }

  // Terminal que sumiu do banco entre a emissão e o uso. A mensagem é a mesma
  // de credencial inválida: quem apresenta um token de terminal apagado não
  // precisa saber qual das duas coisas aconteceu.
  if (!terminal) {
    return { ok: false, motivo: 'terminal_desconhecido', erro: 'Credencial inválida.', status: 401 }
  }

  // A EMPRESA DO TOKEN TEM QUE BATER COM A DO BANCO.
  //
  // Em operação normal isto nunca dispara — nós assinamos o token, e a empresa
  // saiu desta mesma linha. Dispara em dois casos, e os dois importam: alguém
  // conseguiu forjar um token (então a assinatura vazou), ou o terminal foi
  // movido de empresa depois da emissão. Nos dois, seguir seria escrever na
  // empresa errada.
  if (terminal.empresa_id !== claims.empresa_id) {
    return { ok: false, motivo: 'empresa_divergente', erro: 'Credencial inválida.', status: 401 }
  }

  if (terminal.status === 'revogado') {
    return { ok: false, motivo: 'terminal_revogado', erro: 'Terminal revogado.', status: 403 }
  }
  if (terminal.status !== 'ativo') {
    return { ok: false, motivo: 'terminal_inativo', erro: 'Terminal não está ativo.', status: 403 }
  }
  if (!empresaAtiva) {
    return { ok: false, motivo: 'empresa_inativa', erro: 'A empresa deste terminal está inativa.', status: 403 }
  }

  const usarRotasNovas = operacao
    ? terminal.rotas_habilitadas?.[operacao] === true
    : terminal.usar_rotas_novas === true

  if (exigirFlag && !usarRotasNovas) {
    // 409 e não 403: não é falta de permissão, é uma rota que ainda não foi
    // ligada para este terminal. O PDV lê isto e volta ao caminho legado.
    return {
      ok: false, motivo: 'rota_desligada', status: 409,
      erro: 'Este terminal ainda não foi liberado para a rota nova.',
    }
  }

  return {
    ok: true,
    contexto: {
      terminal_id: terminal.id,
      empresa_id: terminal.empresa_id,   // ← do banco, sempre
      tenant_id: tenantId,
      nome: terminal.nome,
      status: 'ativo',
      versao_pdv: terminal.versao_pdv,
      usar_rotas_novas: usarRotasNovas,
      claims,
    },
  }
}

/**
 * O corpo da requisição trouxe uma empresa? Então ela tem que ser a mesma.
 *
 * A regra de verdade é a de cima: a empresa usada é SEMPRE a do contexto, e
 * nenhuma rota deve ler empresa do corpo. Esta função existe para o caso em
 * que um cliente antigo continua mandando o campo por hábito — aí divergência
 * vira 403 explícito em vez de ser silenciosamente ignorada.
 *
 * Ignorar em silêncio seria defensável e é pior: o dia em que alguém tentar
 * escrever na empresa do vizinho, queremos que apareça no log, não que passe
 * despercebido porque o servidor "fez a coisa certa" sozinho.
 */
export function conferirEmpresaDoCorpo(
  contexto: ContextoTerminal,
  empresaDoCorpo: unknown,
): Acesso | null {
  if (empresaDoCorpo === undefined || empresaDoCorpo === null || empresaDoCorpo === '') return null
  if (String(empresaDoCorpo) === contexto.empresa_id) return null
  return {
    ok: false, motivo: 'empresa_divergente', status: 403,
    erro: 'A empresa informada não é a deste terminal.',
  }
}

/**
 * De onde o token pode vir: do cabeçalho `Authorization`, e de lugar nenhum
 * mais.
 *
 * Em particular NÃO de query string. Um token em URL entra no log de acesso
 * do servidor, no histórico do navegador, no cabeçalho `Referer` de qualquer
 * recurso externo da página e no relatório de erro de qualquer proxy no
 * caminho. Não existe forma de "usar com cuidado" um segredo em URL.
 */
export function tokenDoCabecalho(req: Request): string | null {
  const bruto = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!bruto) return null
  const m = /^Bearer\s+(.+)$/i.exec(bruto.trim())
  return m ? m[1].trim() : null
}
