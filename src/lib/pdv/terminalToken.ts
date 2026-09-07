import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// IDENTIDADE DO TERMINAL PDV — as peças puras.
//
// O que esta fase resolve, e só isto: sair de
//
//     terminal_id = texto editável num JSON local
//     empresa_id  = texto que o cliente escolhe
//
// para
//
//     credencial válida → terminal identificado pelo servidor
//                       → empresa determinada pelo servidor
//                       → token assinado
//
// ── POR QUE ASSINAR COM SEGREDO PRÓPRIO, E NÃO COM O DO SUPABASE ──────────
//
// A tentação é assinar com o JWT secret do projeto Supabase: o PostgREST
// aceitaria o token e o terminal viraria `authenticated` no banco de
// imediato. Seria errado AGORA, por um motivo concreto: `authenticated` tem
// privilégios que `anon` não tem — DELETE e UPDATE em tabelas financeiras,
// entre outros. Um terminal ativado passaria a poder MAIS do que hoje, numa
// etapa cuja regra é não mudar comportamento nenhum.
//
// Então o token desta etapa é verificado pelo NOSSO servidor, com o NOSSO
// segredo. Quando a Etapa B mover as escritas para rotas de servidor, é esse
// mesmo token que as autoriza — e a decisão de emitir um token que o
// PostgREST aceite fica para quando a RLS entrar, com o papel certo.

/** Duração do token. Curta de propósito: é a janela de um terminal roubado. */
export const TOKEN_VALIDADE_SEGUNDOS = 60 * 60 * 12   // 12 horas

/** Validade do código de ativação. Credencial temporária, vida curta. */
export const CODIGO_VALIDADE_MINUTOS = 15

/** Tentativas erradas antes de o código de ativação queimar. */
export const MAX_TENTATIVAS_CODIGO = 5

export type ClaimsTerminal = {
  sub: string
  terminal_id: string
  empresa_id: string
  tenant_id: string | null
  tipo: 'pdv_terminal'
  iat: number
  exp: number
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Assina um JWT HS256.
 *
 * Escrito à mão em vez de trazer `jose` ou `jsonwebtoken`: são 20 linhas de
 * `node:crypto`, e uma dependência nova no caminho de autenticação é
 * superfície que alguém precisa manter atualizada para sempre.
 */
export function assinarToken(
  claims: Omit<ClaimsTerminal, 'iat' | 'exp'>,
  segredo: string,
  agoraSegundos = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    ...claims,
    iat: agoraSegundos,
    exp: agoraSegundos + TOKEN_VALIDADE_SEGUNDOS,
  }))
  const corpo = `${header}.${payload}`
  const assinatura = b64url(createHmac('sha256', segredo).update(corpo).digest())
  return `${corpo}.${assinatura}`
}

export type VerificacaoToken =
  | { ok: true; claims: ClaimsTerminal }
  | { ok: false; erro: 'formato' | 'assinatura' | 'expirado' | 'tipo' | 'claims' }

function textoNaoVazio(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Verifica um token. A ordem importa: assinatura ANTES de qualquer leitura do
 * conteudo, senao estariamos decidindo com base em dado nao autenticado.
 *
 * -- SOBRE ALGORITHM CONFUSION --------------------------------------------
 *
 * A familia de ataques `alg: none` / `alg: RS256` depende de a verificacao
 * PERGUNTAR ao token qual algoritmo usar. Esta nao pergunta: ela calcula o
 * HMAC-SHA256 e compara. Um token com `alg: none` e assinatura vazia
 * simplesmente nao bate com o HMAC esperado e cai em 'assinatura'.
 *
 * A checagem explicita do header abaixo e redundante de proposito -- ela
 * existe para que, se alguem um dia trocar esta funcao por uma biblioteca que
 * aceite o `alg` do token, o teste que a acompanha quebre.
 */
export function verificarToken(
  token: string,
  segredo: string,
  agoraSegundos = Math.floor(Date.now() / 1000),
): VerificacaoToken {
  const partes = String(token ?? '').split('.')
  if (partes.length !== 3) return { ok: false, erro: 'formato' }

  const [header, payload, assinatura] = partes
  const esperada = b64url(createHmac('sha256', segredo).update(`${header}.${payload}`).digest())

  // Comparacao em tempo constante: comparar com `===` vaza, pelo tempo, quantos
  // caracteres iniciais o atacante acertou.
  const a = Buffer.from(assinatura)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, erro: 'assinatura' }

  let cabecalho: { alg?: unknown }
  try {
    cabecalho = JSON.parse(deB64url(header).toString('utf8'))
  } catch {
    return { ok: false, erro: 'formato' }
  }
  if (cabecalho.alg !== 'HS256') return { ok: false, erro: 'assinatura' }

  let claims: ClaimsTerminal
  try {
    claims = JSON.parse(deB64url(payload).toString('utf8'))
  } catch {
    return { ok: false, erro: 'formato' }
  }

  if (claims.tipo !== 'pdv_terminal') return { ok: false, erro: 'tipo' }
  if (!claims.exp || claims.exp <= agoraSegundos) return { ok: false, erro: 'expirado' }

  // Claims obrigatorias. Um token assinado por nos mas sem `terminal_id` ou sem
  // `empresa_id` nao deveria existir -- mas se existisse, quem chama sairia
  // consultando o banco por `undefined`, e o resultado disso e imprevisivel o
  // bastante para nao valer o risco. Falta de claim e recusa, nao improviso.
  if (!textoNaoVazio(claims.terminal_id) || !textoNaoVazio(claims.empresa_id) || !textoNaoVazio(claims.sub)) {
    return { ok: false, erro: 'claims' }
  }

  return { ok: true, claims }
}

/**
 * Verifica contra varios segredos, em ordem, e devolve o primeiro que aceitar.
 *
 * E o que permite ROTAR o `PDV_TOKEN_SECRET` sem dia de virada: durante a
 * janela de rotacao o servidor assina com o novo e ainda aceita o anterior,
 * entao os tokens de ate 12 h emitidos antes da troca continuam validos ate
 * vencerem sozinhos.
 *
 * So a falha de ASSINATURA faz tentar o proximo segredo. Token expirado ou
 * malformado nao melhora com outra chave, e insistir so gastaria HMAC.
 */
export function verificarComRotacao(
  token: string,
  segredos: string[],
  agoraSegundos = Math.floor(Date.now() / 1000),
): VerificacaoToken {
  let ultima: VerificacaoToken = { ok: false, erro: 'assinatura' }
  for (const s of segredos) {
    ultima = verificarToken(token, s, agoraSegundos)
    if (ultima.ok) return ultima
    if (ultima.erro !== 'assinatura') return ultima
  }
  return ultima
}

// ── Código de ativação ────────────────────────────────────────────────────

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // sem I, O, 0, 1

/**
 * Código de ativação legível em voz alta, no formato `AB7F-K93X`.
 *
 * O alfabeto exclui I/O/0/1 porque o código é ditado por telefone ou copiado
 * de uma tela para um balcão — confundir O com zero transforma uma ativação
 * em um chamado de suporte.
 *
 * 32^8 ≈ 1,1 × 10^12 combinações, com validade de 15 minutos e 5 tentativas.
 */
export function gerarCodigoAtivacao(): string {
  const bytes = randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += ALFABETO[bytes[i] % ALFABETO.length]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

/** Normaliza o que o operador digitou: maiúsculas, sem hífen nem espaço. */
export function normalizarCodigo(codigo: string): string {
  return String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function hashDoCodigo(codigo: string): string {
  return createHash('sha256').update(normalizarCodigo(codigo)).digest('hex')
}

/** Os 4 primeiros caracteres, para a tela dizer qual código é sem revelá-lo. */
export function prefixoDoCodigo(codigo: string): string {
  return normalizarCodigo(codigo).slice(0, 4)
}

// ── Segredo do terminal ───────────────────────────────────────────────────

/**
 * O SEGREDO É GERADO PELO TERMINAL, e o servidor guarda só o hash.
 *
 * Parece contraintuitivo — o normal seria o servidor emitir. A razão é
 * idempotência, e é o requisito 29:
 *
 *   servidor ativa → resposta se perde → PDV repete a chamada
 *
 * Se o servidor gerasse o segredo, a repetição encontraria o código já usado
 * e o terminal ficaria travado, porque o segredo da primeira tentativa se
 * perdeu no caminho e o servidor só tem o hash dele. Com o terminal gerando
 * ANTES de chamar, ele já tem o segredo em mãos: repetir a chamada com o
 * mesmo segredo é reconhecido como a mesma ativação.
 *
 * O que se abre mão: a entropia passa a depender do cliente. É aceitável
 * porque o segredo só autoriza AQUELE terminal, e quem o emite é o código de
 * ativação — esse sim gerado pelo servidor, de uso único e vida curta. O
 * servidor ainda assim recusa hash mal formado.
 */
export function gerarSegredoTerminal(): string {
  return randomBytes(32).toString('hex')
}

export function hashDoSegredo(segredo: string): string {
  return createHash('sha256').update(String(segredo ?? '')).digest('hex')
}

/**
 * Um segredo (ou hash de segredo) bem formado: 64 caracteres hexadecimais.
 *
 * Serve para as duas pontas porque `gerarSegredoTerminal` e `hashDoSegredo`
 * produzem o mesmo formato. Recusar o mal formado na entrada evita que uma
 * string vazia ou um `null` virado em `"null"` chegue perto da comparação.
 */
export function segredoBemFormado(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
}

/** @deprecated nome antigo de `segredoBemFormado`. */
export const hashValido = segredoBemFormado

/** Comparação em tempo constante de dois hashes hexadecimais. */
export function hashesIguais(a: string, b: string): boolean {
  const ba = Buffer.from(String(a ?? ''), 'utf8')
  const bb = Buffer.from(String(b ?? ''), 'utf8')
  if (ba.length !== bb.length || ba.length === 0) return false
  return timingSafeEqual(ba, bb)
}
