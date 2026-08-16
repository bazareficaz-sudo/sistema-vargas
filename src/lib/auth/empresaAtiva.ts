// Qual empresa a sessão está operando — ponto único de decisão.
//
// Por que existe: `empresa_id` era lido direto de `profiles` em 146 lugares,
// espalhados por 125 arquivos. Enquanto for assim, qualquer ideia de "trocar
// de empresa sem sair do login" precisaria ser implementada 146 vezes, e a
// tela esquecida gravaria na empresa errada — erro que só aparece no
// fechamento, com estoque dado na loja errada.
//
// Esta função não muda nada hoje: devolve exatamente a empresa do cadastro do
// usuário, como antes. O ganho é ter UM lugar para mudar quando o seletor de
// empresa entrar — aí ela passará a ler a empresa escolhida (cookie de
// sessão) e a validá-la contra `usuario_empresas`, que já existe no banco com
// o papel do usuário em cada empresa.
//
// Detalhe que não é óbvio: hoje a permissão do banco já libera as duas
// empresas. As políticas usam `empresa_do_meu_grupo()`, que aceita qualquer
// empresa do mesmo tenant — o que segura o usuário numa empresa só é a
// interface, não o banco. Por isso o seletor não amplia acesso; e por isso a
// validação contra `usuario_empresas` (fatia 2) APERTA o que existe hoje.

export type PerfilSessao = Record<string, any> & { empresa_id: string | null }

/**
 * Lê o perfil da sessão com a empresa ativa resolvida.
 *
 * `campos` aceita a mesma lista que o `select` original de cada tela (ex.:
 * `'empresa_id, role, nome'`) — o que vier além de `empresa_id` é devolvido
 * como está. `empresa_id` é o único campo que passa a ser decidido aqui.
 *
 * Devolve `null` quando não há perfil, para o chamador continuar tratando
 * como tratava (`profile?.empresa_id`).
 */
export async function perfilDaSessao(
  sb: any,
  userId: string,
  campos: string = 'empresa_id',
): Promise<PerfilSessao | null> {
  // `empresa_id` sempre entra na consulta, mesmo que a tela não peça: é dele
  // que sai a empresa ativa enquanto o seletor não existe.
  const lista = campos.includes('empresa_id') ? campos : `empresa_id, ${campos}`

  const { data } = await sb.from('profiles').select(lista).eq('id', userId).single()
  if (!data) return null

  return { ...data, empresa_id: data.empresa_id ?? null }
}

/** Só o id, para os pontos que não precisam do resto do perfil. */
export async function empresaAtivaId(sb: any, userId: string): Promise<string | null> {
  const perfil = await perfilDaSessao(sb, userId)
  return perfil?.empresa_id ?? null
}
