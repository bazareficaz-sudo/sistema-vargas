import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Autenticação da extensão do Chrome.
//
// A extensão NÃO carrega senha nem credencial de marketplace. Ela carrega um
// token próprio, gerado no sistema, com validade e revogação — é o que a
// seção 25 do documento pede.
//
// Por que não usar o cookie de sessão do site: o cookie do Supabase é
// SameSite=Lax, e requisição partindo de uma extensão é tratada como
// cross-site — o cookie simplesmente não é enviado. Token explícito no
// cabeçalho resolve isso e ainda deixa o acesso da extensão auditável em
// separado do acesso pelo navegador.

export const HEADER_TOKEN = 'x-vargas-extensao-token'

/** Dias de validade de um token novo. Renovar é gerar outro. */
export const VALIDADE_DIAS = 90

export function gerarToken(): { token: string; hash: string; prefixo: string } {
  // 32 bytes = 256 bits. base64url para caber num campo de texto sem escapar.
  const token = `vgx_${crypto.randomBytes(32).toString('base64url')}`
  return { token, hash: hashToken(token), prefixo: token.slice(0, 12) }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

export type ContextoExtensao = {
  tokenId: string
  empresaId: string
  userId: string
  nomeDispositivo: string
}

export type ResultadoValidacao =
  | { ok: true; ctx: ContextoExtensao }
  | { ok: false; erro: string; status: number }

/**
 * Valida o token enviado pela extensão e devolve empresa e usuário.
 *
 * Usa a chave de serviço porque não há sessão de navegador nenhuma nesta
 * requisição — a autorização VEM do token, e é ele que determina a empresa.
 * Nenhuma rota da extensão deve aceitar empresa_id vindo do corpo.
 */
export async function validarTokenExtensao(req: Request): Promise<ResultadoValidacao> {
  const bruto = req.headers.get(HEADER_TOKEN)
    // Aceita também Authorization: Bearer, que é o que muita ferramenta manda
    // por padrão — recusar por causa do nome do cabeçalho seria atrito à toa.
    ?? (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')

  const token = (bruto ?? '').trim()
  if (!token) return { ok: false, erro: 'Token da extensão ausente.', status: 401 }

  const sb = createAdminClient()
  const { data: linha, error } = await sb
    .from('extensao_tokens')
    .select('id, empresa_id, user_id, nome_dispositivo, expira_em, revogado_em')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  if (error) return { ok: false, erro: `Falha ao validar token: ${error.message}`, status: 500 }
  if (!linha) return { ok: false, erro: 'Token inválido. Gere um novo no sistema.', status: 401 }
  if (linha.revogado_em) return { ok: false, erro: 'Este token foi revogado.', status: 401 }
  if (new Date(linha.expira_em).getTime() < Date.now()) {
    return { ok: false, erro: 'Token expirado. Gere um novo no sistema.', status: 401 }
  }

  return {
    ok: true,
    ctx: {
      tokenId: linha.id,
      empresaId: linha.empresa_id,
      userId: linha.user_id,
      nomeDispositivo: linha.nome_dispositivo,
    },
  }
}

/**
 * Marca uso do token. Falha aqui não pode derrubar a captura — é registro,
 * não regra de negócio.
 */
export async function registrarUso(tokenId: string, req: Request, capturou: boolean) {
  try {
    const sb = createAdminClient()
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const { data: atual } = await sb.from('extensao_tokens')
      .select('total_capturas').eq('id', tokenId).single()
    await sb.from('extensao_tokens').update({
      ultimo_uso_em: new Date().toISOString(),
      ultimo_uso_ip: ip,
      total_capturas: (atual?.total_capturas ?? 0) + (capturou ? 1 : 0),
    }).eq('id', tokenId)
  } catch { /* registro de uso é melhor-esforço */ }
}
