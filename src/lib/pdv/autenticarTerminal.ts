import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verificarComRotacao } from './terminalToken'
import { segredosDeVerificacao } from './segredo'
import { decidirAcesso, tokenDoCabecalho, type Acesso, type ContextoTerminal } from './decidirAcesso'

// O PORTÃO ÚNICO DAS ROTAS DO PDV.
//
// Toda rota protegida começa por aqui, e nenhuma repete a verificação por
// conta própria. O motivo não é economia de linhas: é que validação de token
// copiada em N rotas vira N versões ligeiramente diferentes, e a que estiver
// desatualizada é a que o atacante vai usar.

export type { ContextoTerminal }
export { tokenDoCabecalho }

/**
 * Autentica o terminal por trás desta requisição.
 *
 * Devolve o contexto com a empresa lida DO BANCO — nunca do token sozinho, e
 * jamais do corpo. O token diz qual terminal alega ser; o banco diz o que
 * aquele terminal é hoje.
 *
 * `exigirFlag: true` (o padrão para operação migrada) recusa terminal que
 * ainda não foi liberado no rollout.
 */
export async function autenticarTerminalPdv(
  req: Request,
  { exigirFlag = true }: { exigirFlag?: boolean } = {},
): Promise<Acesso> {
  const token = tokenDoCabecalho(req)
  if (!token) {
    return { ok: false, motivo: 'sem_token', erro: 'Credencial ausente.', status: 401 }
  }

  const v = verificarComRotacao(token, segredosDeVerificacao())
  if (!v.ok) {
    // Expirado é o único caso que o PDV trata diferente: ele renova e repete.
    // Os demais viram a mesma mensagem, porque distinguir "assinatura errada"
    // de "claim faltando" só ajudaria quem está tentando forjar.
    return v.erro === 'expirado'
      ? { ok: false, motivo: 'token_expirado', erro: 'Token expirado.', status: 401 }
      : { ok: false, motivo: 'token_invalido', erro: 'Credencial inválida.', status: 401 }
  }

  const sb = createAdminClient()

  const { data: terminal } = await sb
    .from('pdv_terminais')
    .select('id, empresa_id, status, nome, versao_pdv, usar_rotas_novas')
    .eq('id', v.claims.terminal_id)
    .maybeSingle()

  const { data: empresa } = terminal
    ? await sb.from('empresas').select('id, tenant_id, ativo').eq('id', terminal.empresa_id).maybeSingle()
    : { data: null }

  const acesso = decidirAcesso({
    claims: v.claims,
    terminal,
    tenantId: empresa?.tenant_id ?? null,
    empresaAtiva: empresa?.ativo !== false,
    exigirFlag,
  })

  // "Visto por último" avança em toda requisição autenticada, inclusive nas
  // recusadas. É o que distingue um terminal parado de um terminal insistindo
  // com credencial que não vale mais.
  if (terminal) {
    await sb.from('pdv_terminais')
      .update({ ultima_atividade_em: new Date().toISOString() })
      .eq('id', terminal.id)
  }

  return acesso
}

/** A recusa como resposta HTTP. O `motivo` vai no corpo para o PDV decidir o que fazer. */
export function respostaDeRecusa(acesso: Extract<Acesso, { ok: false }>) {
  return NextResponse.json(
    { ok: false, erro: acesso.erro, motivo: acesso.motivo },
    { status: acesso.status },
  )
}
