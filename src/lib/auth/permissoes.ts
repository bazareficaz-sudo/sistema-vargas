// Fundação de autorização — papéis fixos (não é matriz configurável pela
// UI). PERMISSOES_POR_PAPEL é a única fonte de verdade de quem pode o quê;
// exigirPermissao() é o "one-liner" que toda rota sensível deve chamar —
// nunca confiar só em esconder botão na tela.

export type Papel = 'admin' | 'gerente' | 'financeiro' | 'estoque' | 'vendas' | 'leitura'

export type PermissaoCodigo =
  | 'gerenciar_usuarios'
  | 'gerenciar_configuracoes'
  | 'ver_custos_margens'
  | 'excluir_cadastros'
  | 'gerenciar_financeiro'
  | 'gerenciar_estoque'
  | 'gerenciar_compras'
  | 'gerenciar_fiscal'
  | 'gerenciar_marketplaces'
  | 'realizar_vendas'
  | 'cancelar_venda'
  | 'gerenciar_whatsapp'
  | 'exportar_dados'

export const PAPEIS: { valor: Papel; label: string }[] = [
  { valor: 'admin', label: 'Administrador' },
  { valor: 'gerente', label: 'Gerente' },
  { valor: 'financeiro', label: 'Financeiro' },
  { valor: 'estoque', label: 'Estoque' },
  { valor: 'vendas', label: 'Vendas' },
  { valor: 'leitura', label: 'Somente leitura' },
]

const PERMISSOES_POR_PAPEL: Record<Papel, Set<PermissaoCodigo>> = {
  admin: new Set([
    'gerenciar_usuarios', 'gerenciar_configuracoes', 'ver_custos_margens', 'excluir_cadastros',
    'gerenciar_financeiro', 'gerenciar_estoque', 'gerenciar_compras', 'gerenciar_fiscal',
    'gerenciar_marketplaces', 'realizar_vendas', 'cancelar_venda', 'gerenciar_whatsapp', 'exportar_dados',
  ]),
  gerente: new Set([
    'ver_custos_margens', 'excluir_cadastros', 'gerenciar_financeiro', 'gerenciar_estoque',
    'gerenciar_compras', 'gerenciar_fiscal', 'gerenciar_marketplaces', 'realizar_vendas',
    'cancelar_venda', 'gerenciar_whatsapp', 'exportar_dados',
  ]),
  financeiro: new Set([
    'ver_custos_margens', 'gerenciar_financeiro', 'gerenciar_fiscal', 'exportar_dados',
  ]),
  estoque: new Set([
    'ver_custos_margens', 'gerenciar_estoque', 'gerenciar_compras', 'exportar_dados',
  ]),
  vendas: new Set([
    'realizar_vendas',
  ]),
  leitura: new Set([]),
}

export function temPermissao(papel: Papel | null | undefined, codigo: PermissaoCodigo): boolean {
  if (!papel) return false
  return PERMISSOES_POR_PAPEL[papel]?.has(codigo) ?? false
}

export type ResultadoGuarda =
  | { ok: true; userId: string; empresaId: string; role: Papel }
  | { ok: false; status: 401 | 403; erro: string }

// Guarda de servidor pra rotas novas: autentica, confirma que o usuário
// está ativo e que o papel dele tem a permissão pedida. Devolve 401/403 em
// vez de deixar a rota seguir — chamar isso é a validação real, esconder
// botão na tela é só cosmético.
export async function exigirPermissao(supabase: any, codigo: PermissaoCodigo): Promise<ResultadoGuarda> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, erro: 'Não autenticado' }

  const { data: profile } = await supabase.from('profiles')
    .select('empresa_id, role, status').eq('id', user.id).single()

  if (!profile?.empresa_id) return { ok: false, status: 403, erro: 'Empresa não identificada' }
  if (profile.status && profile.status !== 'ativo') return { ok: false, status: 403, erro: 'Usuário sem acesso ativo' }
  if (!temPermissao(profile.role as Papel, codigo)) return { ok: false, status: 403, erro: 'Sem permissão para esta ação' }

  return { ok: true, userId: user.id, empresaId: profile.empresa_id, role: profile.role as Papel }
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
