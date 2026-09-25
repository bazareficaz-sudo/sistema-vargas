import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Autenticação do Vargas Marketing (outro sistema, outro banco).
//
// Mesmo desenho dos tokens da extensão: valor aleatório mostrado uma vez,
// banco com o SHA-256, validade e revogação. A empresa vem do token — nenhuma
// rota da integração aceita empresa_id vindo da requisição.

export const VALIDADE_DIAS = 365

export function gerarToken(): { token: string; hash: string; prefixo: string } {
  const token = `vgm_${crypto.randomBytes(32).toString('base64url')}`
  return { token, hash: hashToken(token), prefixo: token.slice(0, 12) }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

export type ContextoIntegracao = { tokenId: string; empresaId: string }
export type ResultadoValidacao =
  | { ok: true; ctx: ContextoIntegracao }
  | { ok: false; code: string; erro: string; status: number }

export async function validarTokenMarketing(req: Request): Promise<ResultadoValidacao> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, code: 'unauthorized', erro: 'Token ausente.', status: 401 }

  const { data: linha, error } = await createAdminClient()
    .from('integracao_marketing_tokens')
    .select('id, empresa_id, expira_em, revogado_em')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  if (error) return { ok: false, code: 'internal', erro: 'Falha ao validar o token.', status: 500 }
  if (!linha) return { ok: false, code: 'unauthorized', erro: 'Token inválido.', status: 401 }
  if (linha.revogado_em) return { ok: false, code: 'revoked', erro: 'Token revogado.', status: 401 }
  if (new Date(linha.expira_em).getTime() < Date.now()) return { ok: false, code: 'expired', erro: 'Token expirado.', status: 401 }
  return { ok: true, ctx: { tokenId: linha.id, empresaId: linha.empresa_id } }
}

/** Registro de uso: melhor-esforço, nunca derruba a chamada. */
export async function registrarUso(tokenId: string) {
  try {
    const sb = createAdminClient()
    const { data } = await sb.from('integracao_marketing_tokens').select('total_chamadas').eq('id', tokenId).single()
    await sb.from('integracao_marketing_tokens')
      .update({ ultimo_uso_em: new Date().toISOString(), total_chamadas: (data?.total_chamadas ?? 0) + 1 })
      .eq('id', tokenId)
  } catch { /* registro é melhor-esforço */ }
}

export function erroJson(code: string, message: string, status: number, retryable = false) {
  return Response.json({ code, message, retryable, request_id: crypto.randomUUID() }, { status })
}
