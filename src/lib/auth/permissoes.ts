// Autorização no SERVIDOR: exigirPermissao() e auditoria. O vocabulário
// (papéis, permissões, temPermissao) mora em ./permissoesBase, que as telas
// do navegador importam direto — este arquivo lê cookies da requisição e não
// pode ir para o bundle do cliente.
import { buscarExcecoes, permissoesEfetivas, type Papel, type PermissaoCodigo } from './permissoesBase'
import { resolverEmpresaAtiva } from './empresaAtiva'

export * from './permissoesBase'

export type ResultadoGuarda =
  | { ok: true; userId: string; empresaId: string; role: Papel; tenantId: string | null }
  | { ok: false; status: 401 | 403; erro: string }

// Guarda de servidor pra rotas novas: autentica, confirma que o usuário
// está ativo e que o papel dele tem a permissão pedida. Devolve 401/403 em
// vez de deixar a rota seguir — chamar isso é a validação real, esconder
// botão na tela é só cosmético.
export async function exigirPermissao(supabase: any, codigo: PermissaoCodigo): Promise<ResultadoGuarda> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, erro: 'Não autenticado' }

  const { data: profile } = await supabase.from('profiles')
    .select('empresa_id, role, status, tenant_id').eq('id', user.id).single()

  if (!profile?.empresa_id) return { ok: false, status: 403, erro: 'Empresa não identificada' }
  if (profile.status && profile.status !== 'ativo') return { ok: false, status: 403, erro: 'Usuário sem acesso ativo' }
  // As excecoes por usuario valem tambem no servidor — senao o gestor
  // desligaria algo na tela e a rota continuaria aceitando.
  const excecoes = await buscarExcecoes(supabase, user.id)
  if (!permissoesEfetivas(profile.role as Papel, excecoes).includes(codigo)) {
    return { ok: false, status: 403, erro: 'Sem permissão para esta ação' }
  }

  // A empresa em que o usuário ESTÁ — a escolhida no seletor, conferida
  // contra usuario_empresas —, não a do cadastro. Antes era a do cadastro:
  // logado na outra empresa do grupo, ~90 telas e rotas liam e GRAVAVAM na
  // empresa errada sem ninguém perceber. Sem escolha (ou fora de requisição,
  // como no cron) continua sendo a do cadastro.
  const empresaId = await resolverEmpresaAtiva(supabase, user.id, profile.empresa_id)

  return { ok: true, userId: user.id, empresaId, role: profile.role as Papel, tenantId: profile.tenant_id ?? null }
}

// Insere em empresa_auditoria (tabela já existente no schema, dormente até
// agora) — histórico básico de quem fez o quê.
export async function registrarAuditoria(supabase: any, params: {
  empresaId: string
  usuarioId: string
  usuarioNome?: string | null
  acao: string
  tabela?: string
  campo?: string
  valorAnterior?: unknown
  valorNovo?: unknown
}): Promise<void> {
  await supabase.from('empresa_auditoria').insert({
    empresa_id: params.empresaId,
    usuario_id: params.usuarioId,
    usuario_nome: params.usuarioNome ?? null,
    acao: params.acao,
    tabela: params.tabela ?? null,
    campo: params.campo ?? null,
    valor_anterior: params.valorAnterior ?? null,
    valor_novo: params.valorNovo ?? null,
  })
}
