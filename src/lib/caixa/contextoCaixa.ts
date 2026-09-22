// Quem está operando o Caixa, e de qual empresa — ponto único de decisão
// do domínio financeiro.
//
// POR QUE EXISTE (FASE 1.1)
//
// A Fase 1 usou `exigirPermissao`, que lê `profiles.empresa_id` DIRETO. Mas
// o sistema tem seletor de empresa desde a fatia de `empresaAtiva.ts`: o
// operador escolhe a empresa, um cookie httpOnly guarda a escolha e
// `perfilDaSessao` a confere contra `usuario_empresas` a cada requisição.
// O layout do dashboard respeita isso. `exigirPermissao`, não.
//
// O resultado era um erro silencioso e caro: o operador troca para "BAZAR
// OURO E PRATA" no seletor, abre o Caixa, e a tela mostra — e movimenta —
// a tesouraria da "Bazar Eficaz". Dinheiro lançado na empresa errada, num
// ledger append-only onde a correção é estorno, não edição.
//
// A auditoria mediu o alcance: 70 rotas usam `exigirPermissao` e só 4
// resolvem a empresa ativa. Consertar as 70 é outra fase. Aqui conserta-se
// o Caixa, que é onde o erro vira dinheiro. Ver a dívida registrada em
// `docs/auditoria/DIVIDA-TECNICA.md`.
//
// A REGRA DE EMPRESA — e por que não é "tem que ter vínculo"
//
// `usuario_empresas` só é preenchida para quem opera mais de uma empresa.
// Há hoje um gerente ativo com ZERO linhas lá, operando a própria empresa
// normalmente. Exigir vínculo sempre o expulsaria do Caixa.
//
// Então:
//   • a empresa do cadastro (`profiles.empresa_id`) sempre vale;
//   • qualquer OUTRA empresa exige vínculo ativo em `usuario_empresas`.
//
// É exatamente o que `perfilDaSessao` já faz. Esta lib não reimplementa a
// regra — chama aquela — mas RECONFERE o resultado antes de devolvê-lo. A
// reconferência não é desconfiança do código de hoje: é o que faz uma
// futura mudança em `empresaAtiva.ts` quebrar um teste do Caixa em vez de
// afrouxar o financeiro em silêncio.
//
// O CLIENTE NÃO ESCOLHE EMPRESA. Nenhuma rota do Caixa lê `empresa_id` do
// corpo ou da query — a empresa vem daqui, e só daqui. É por isso que a
// função não aceita nenhum parâmetro de empresa: não há como passar um.

import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { buscarExcecoes, permissoesEfetivas, type Papel, type PermissaoCodigo } from '@/lib/auth/permissoes'

export type ContextoCaixa = {
  ok: true
  userId: string
  /** A empresa ativa já validada. Nunca vem do navegador. */
  empresaId: string
  role: Papel
}

export type RecusaCaixa = {
  ok: false
  status: 401 | 403
  erro: string
}

/**
 * A regra pura de empresa, isolada para poder ser testada sem sessão, sem
 * cookie e sem banco.
 *
 * @param alvo            a empresa que se quer operar
 * @param doCadastro      `profiles.empresa_id`
 * @param vinculosAtivos  empresas com vínculo ativo em `usuario_empresas`
 */
export function podeOperarEmpresa(
  alvo: string | null | undefined,
  doCadastro: string | null | undefined,
  vinculosAtivos: readonly string[],
): boolean {
  if (!alvo) return false
  if (alvo === doCadastro) return true
  return vinculosAtivos.includes(alvo)
}

/**
 * Autentica, resolve a empresa ativa e confere a permissão.
 *
 * Devolve 401/403 em vez de deixar a rota seguir — mesmo contrato de
 * `exigirPermissao`, para as rotas do Caixa trocarem uma pela outra sem
 * mudar o tratamento de erro.
 */
export async function contextoCaixa(
  sb: any,
  codigo: PermissaoCodigo = 'gerenciar_financeiro',
): Promise<ContextoCaixa | RecusaCaixa> {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { ok: false, status: 401, erro: 'Não autenticado' }

  // `perfilDaSessao` é quem lê o cookie de empresa ativa e o confere contra
  // `usuario_empresas`. Cookie forjado cai de volta na empresa do cadastro,
  // em silêncio — quem forjou não descobre que a empresa existe.
  const perfil = await perfilDaSessao(sb, user.id, 'empresa_id, role, status')
  if (!perfil?.empresa_id) return { ok: false, status: 403, erro: 'Empresa não identificada' }
  if (perfil.status && perfil.status !== 'ativo') {
    return { ok: false, status: 403, erro: 'Usuário sem acesso ativo' }
  }

  // Reconferência — ver o cabeçalho. Relê o cadastro e os vínculos e aplica
  // a regra de novo sobre a empresa que veio resolvida.
  const { data: cadastro } = await sb.from('profiles').select('empresa_id').eq('id', user.id).single()
  const { data: vinculos } = await sb.from('usuario_empresas')
    .select('empresa_id').eq('user_id', user.id).eq('ativo', true)

  const permitidas = (vinculos ?? []).map((v: { empresa_id: string }) => v.empresa_id)
  if (!podeOperarEmpresa(perfil.empresa_id, cadastro?.empresa_id, permitidas)) {
    return { ok: false, status: 403, erro: 'Você não tem acesso a essa empresa.' }
  }

  // As exceções por usuário valem no servidor também — senão o gestor
  // desligaria a permissão na tela e a rota continuaria aceitando.
  const excecoes = await buscarExcecoes(sb, user.id)
  if (!permissoesEfetivas(perfil.role as Papel, excecoes).includes(codigo)) {
    return { ok: false, status: 403, erro: 'Sem permissão para esta ação' }
  }

  return { ok: true, userId: user.id, empresaId: perfil.empresa_id, role: perfil.role as Papel }
}
