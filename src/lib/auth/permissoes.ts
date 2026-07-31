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
  | 'ver_dados_grupo'
  // Visibilidade de numeros do negocio — o que o gestor normalmente nao quer
  // que o funcionario de balcao veja.
  | 'ver_totais_vendas'
  | 'ver_dashboard_financeiro'
  // Edicao de cadastro, separada em pedacos porque na pratica sao decisoes
  // diferentes: mexer na ficha do produto nao e o mesmo que mexer no preco.
  | 'editar_produtos'
  | 'editar_precos'
  | 'editar_credito_cliente'

export const PAPEIS: { valor: Papel; label: string }[] = [
  { valor: 'admin', label: 'Administrador' },
  { valor: 'gerente', label: 'Gerente' },
  { valor: 'financeiro', label: 'Financeiro' },
  { valor: 'estoque', label: 'Estoque' },
  { valor: 'vendas', label: 'Vendas' },
  { valor: 'leitura', label: 'Somente leitura' },
]

export const GRUPOS_PERMISSAO: { grupo: string; itens: { codigo: PermissaoCodigo; label: string; ajuda: string }[] }[] = [
  {
    grupo: 'Numeros do negocio',
    itens: [
      { codigo: 'ver_totais_vendas', label: 'Ver totais de vendas', ajuda: 'Faturamento do dia/mes, ticket medio e valores somados nas telas de Pedidos e Vendas. Sem isso, a pessoa ve os pedidos mas nao os totais.' },
      { codigo: 'ver_dashboard_financeiro', label: 'Ver painel financeiro na Visao Geral', ajuda: 'Cartoes de vendas, faturamento, a receber e a pagar na tela inicial.' },
      { codigo: 'ver_custos_margens', label: 'Ver custo, lucro e margem', ajuda: 'Custo de compra, lucro e margem em qualquer tela.' },
      { codigo: 'exportar_dados', label: 'Exportar dados (CSV/Excel)', ajuda: 'Baixar listagens e relatorios.' },
    ],
  },
  {
    grupo: 'Cadastros',
    itens: [
      { codigo: 'editar_produtos', label: 'Editar produtos', ajuda: 'Alterar a ficha do produto: nome, categoria, fiscal, dimensoes.' },
      { codigo: 'editar_precos', label: 'Alterar preco de venda', ajuda: 'Mudar preco no cadastro, em massa ou pela gestao de precos.' },
      { codigo: 'editar_credito_cliente', label: 'Editar credito de cliente', ajuda: 'Lancar ou alterar credito e limite do cliente.' },
      { codigo: 'excluir_cadastros', label: 'Excluir/desativar cadastros', ajuda: 'Produto, cliente e fornecedor.' },
    ],
  },
  {
    grupo: 'Operacao',
    itens: [
      { codigo: 'realizar_vendas', label: 'Vender no PDV', ajuda: '' },
      { codigo: 'cancelar_venda', label: 'Cancelar venda', ajuda: '' },
      { codigo: 'gerenciar_estoque', label: 'Mexer no estoque', ajuda: 'Ajuste, transferencia e inventario.' },
      { codigo: 'gerenciar_compras', label: 'Entradas e compras', ajuda: '' },
      { codigo: 'gerenciar_financeiro', label: 'Financeiro', ajuda: 'Contas a pagar e receber, caixa.' },
      { codigo: 'gerenciar_fiscal', label: 'Emitir e cancelar nota', ajuda: '' },
      { codigo: 'gerenciar_marketplaces', label: 'Marketplaces', ajuda: 'Anuncios, pedidos e integracoes.' },
      { codigo: 'gerenciar_whatsapp', label: 'WhatsApp e automacoes', ajuda: '' },
    ],
  },
  {
    grupo: 'Administracao',
    itens: [
      { codigo: 'gerenciar_usuarios', label: 'Gerenciar usuarios', ajuda: 'Convidar, editar papel e bloquear.' },
      { codigo: 'gerenciar_configuracoes', label: 'Configuracoes da empresa', ajuda: 'Dados da empresa, fiscal, integracoes.' },
      { codigo: 'ver_dados_grupo', label: 'Ver dados de empresas do grupo', ajuda: '' },
    ],
  },
]

const PERMISSOES_POR_PAPEL: Record<Papel, Set<PermissaoCodigo>> = {
  admin: new Set([
    'gerenciar_usuarios', 'gerenciar_configuracoes', 'ver_custos_margens', 'excluir_cadastros',
    'gerenciar_financeiro', 'gerenciar_estoque', 'gerenciar_compras', 'gerenciar_fiscal',
    'gerenciar_marketplaces', 'realizar_vendas', 'cancelar_venda', 'gerenciar_whatsapp', 'exportar_dados',
    'ver_dados_grupo', 'ver_totais_vendas', 'ver_dashboard_financeiro',
    'editar_produtos', 'editar_precos', 'editar_credito_cliente',
  ]),
  gerente: new Set([
    'ver_custos_margens', 'excluir_cadastros', 'gerenciar_financeiro', 'gerenciar_estoque',
    'gerenciar_compras', 'gerenciar_fiscal', 'gerenciar_marketplaces', 'realizar_vendas',
    'cancelar_venda', 'gerenciar_whatsapp', 'exportar_dados', 'ver_dados_grupo',
    'ver_totais_vendas', 'ver_dashboard_financeiro',
    'editar_produtos', 'editar_precos', 'editar_credito_cliente',
  ]),
  financeiro: new Set([
    'ver_custos_margens', 'gerenciar_financeiro', 'gerenciar_fiscal', 'exportar_dados',
    'ver_totais_vendas', 'ver_dashboard_financeiro', 'editar_credito_cliente',
  ]),
  estoque: new Set([
    'ver_custos_margens', 'gerenciar_estoque', 'gerenciar_compras', 'exportar_dados',
    'editar_produtos',
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

export type Excecoes = Record<string, boolean>

/** O que o papel da por padrao — usado pra mostrar o "padrao do papel" na tela. */
export function permissoesDoPapel(papel: Papel | null | undefined): PermissaoCodigo[] {
  if (!papel) return []
  return [...(PERMISSOES_POR_PAPEL[papel] ?? [])]
}

/** Papel + excecoes do usuario. E esta a resposta que vale em qualquer lugar. */
export function permissoesEfetivas(papel: Papel | null | undefined, excecoes: Excecoes = {}): PermissaoCodigo[] {
  const base = new Set(permissoesDoPapel(papel))
  for (const [codigo, permitido] of Object.entries(excecoes)) {
    if (permitido) base.add(codigo as PermissaoCodigo)
    else base.delete(codigo as PermissaoCodigo)
  }
  return [...base]
}

/** Busca as excecoes de um usuario. Sem linhas, devolve {} e vale so o papel. */
export async function buscarExcecoes(supabase: any, usuarioId: string): Promise<Excecoes> {
  const { data } = await supabase.from('usuario_permissoes')
    .select('codigo, permitido').eq('usuario_id', usuarioId)
  const mapa: Excecoes = {}
  for (const r of data ?? []) mapa[r.codigo] = r.permitido
  return mapa
}

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

  return { ok: true, userId: user.id, empresaId: profile.empresa_id, role: profile.role as Papel, tenantId: profile.tenant_id ?? null }
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
