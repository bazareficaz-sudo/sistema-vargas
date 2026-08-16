import { cookies } from 'next/headers'

// Qual empresa a sessão está operando — ponto único de decisão.
//
// Por que existe: `empresa_id` era lido direto de `profiles` em 146 lugares,
// espalhados por 125 arquivos. Enquanto fosse assim, "trocar de empresa sem
// sair do login" precisaria ser implementado 146 vezes, e a tela esquecida
// gravaria na empresa errada — erro que só aparece no fechamento, com estoque
// dado na loja errada.
//
// Como funciona agora:
//   1. Sem cookie de empresa ativa, vale a empresa do cadastro (comportamento
//      de sempre — quem tem uma empresa só nunca sai daqui).
//   2. Com cookie, o id é CONFERIDO contra `usuario_empresas` a cada
//      requisição. Cookie apontando para empresa não concedida é ignorado em
//      silêncio, e a sessão volta para a empresa do cadastro.
//
// A conferência é no servidor de propósito. Cookie é dado do navegador: se a
// validação fosse só na tela, trocar de empresa seria editar um cookie.
//
// Vale notar que o banco também trava: `empresa_do_meu_grupo()` passou a
// consultar `usuario_empresas` (ver supabase-usuario-empresas.sql). Antes ela
// aceitava qualquer empresa do mesmo tenant, então esta fatia APERTA o acesso
// em vez de ampliá-lo.

export const COOKIE_EMPRESA = 'empresa_ativa'

export type PerfilSessao = Record<string, any> & { empresa_id: string | null }

export type EmpresaDoUsuario = {
  id: string
  nome: string
  perfil: string
  padrao: boolean
}

/**
 * Empresas que este usuário pode operar.
 *
 * Sai de `usuario_empresas`, cuja política só devolve as linhas do próprio
 * usuário. Lista com uma empresa só significa que não há o que trocar — a
 * tela esconde o seletor nesse caso.
 */
export async function empresasDoUsuario(sb: any, userId: string): Promise<EmpresaDoUsuario[]> {
  const { data } = await sb
    .from('usuario_empresas')
    .select('empresa_id, perfil, empresa_padrao, ativo, empresas(nome, nome_fantasia)')
    .eq('user_id', userId).eq('ativo', true)

  return (data ?? []).map((v: any) => ({
    id: v.empresa_id,
    nome: v.empresas?.nome_fantasia || v.empresas?.nome || 'Empresa',
    perfil: v.perfil ?? 'operador',
    padrao: !!v.empresa_padrao,
  })).sort((a: EmpresaDoUsuario, b: EmpresaDoUsuario) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** O cookie da requisição atual, quando existe. */
async function empresaEscolhida(): Promise<string | null> {
  try {
    const jar = await cookies()
    return jar.get(COOKIE_EMPRESA)?.value ?? null
  } catch {
    // Fora de contexto de requisição (rotina de servidor, cron). Aí não há
    // usuário escolhendo nada, e a empresa do cadastro é a resposta certa.
    return null
  }
}

/**
 * Lê o perfil da sessão com a empresa ativa já resolvida.
 *
 * `campos` aceita a mesma lista que o `select` original de cada tela (ex.:
 * `'empresa_id, role, nome'`) — o que vier além de `empresa_id` é devolvido
 * como está. `empresa_id` é o único campo decidido aqui.
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
  // que sai a empresa padrão.
  const lista = campos.includes('empresa_id') ? campos : `empresa_id, ${campos}`

  const { data } = await sb.from('profiles').select(lista).eq('id', userId).single()
  if (!data) return null

  const doCadastro: string | null = data.empresa_id ?? null
  const escolhida = await empresaEscolhida()

  // Caminho comum — nenhum custo extra para quem tem uma empresa só.
  if (!escolhida || escolhida === doCadastro) {
    return { ...data, empresa_id: doCadastro }
  }

  const { data: vinculo } = await sb
    .from('usuario_empresas')
    .select('empresa_id')
    .eq('user_id', userId).eq('empresa_id', escolhida).eq('ativo', true)
    .maybeSingle()

  // Sem vínculo, o cookie não vale nada. Silêncio de propósito: quem forjou o
  // cookie não recebe confirmação de que a empresa existe.
  return { ...data, empresa_id: vinculo ? escolhida : doCadastro }
}

/** Só o id, para os pontos que não precisam do resto do perfil. */
export async function empresaAtivaId(sb: any, userId: string): Promise<string | null> {
  const perfil = await perfilDaSessao(sb, userId)
  return perfil?.empresa_id ?? null
}
