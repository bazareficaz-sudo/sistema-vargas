// Fundação de autorização — papéis fixos (não é matriz configurável pela
// UI). PERMISSOES_POR_PAPEL é a única fonte de verdade de quem pode o quê;
// exigirPermissao() (em ./permissoes, só servidor) é o "one-liner" que toda
// rota sensível deve chamar — nunca confiar só em esconder botão na tela.
//
// Este arquivo é a parte que o NAVEGADOR também usa (papéis, rótulos,
// temPermissao). Não importe nada de servidor aqui: as telas client
// importam daqui, e `./permissoes` puxa cookies da requisição.

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
  // Terminais de PDV: autorizar, ativar e revogar. Um codigo so, e nao tres:
  // quem pode autorizar um terminal pode revoga-lo, e separar criaria uma
  // matriz que ninguem configura na pratica.
  | 'gerenciar_terminais_pdv'

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
      { codigo: 'gerenciar_terminais_pdv', label: 'Gerenciar terminais de PDV', ajuda: 'Autorizar, ativar e revogar os terminais de caixa da empresa.' },
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
    'gerenciar_terminais_pdv',
  ]),
  gerente: new Set([
    'ver_custos_margens', 'excluir_cadastros', 'gerenciar_financeiro', 'gerenciar_estoque',
    'gerenciar_compras', 'gerenciar_fiscal', 'gerenciar_marketplaces', 'realizar_vendas',
    'cancelar_venda', 'gerenciar_whatsapp', 'exportar_dados', 'ver_dados_grupo',
    'ver_totais_vendas', 'ver_dashboard_financeiro',
    'editar_produtos', 'editar_precos', 'editar_credito_cliente',
    'gerenciar_terminais_pdv',
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

// ── Permissao de TELA ────────────────────────────────────────────────────────
//
// Diferente das permissoes de acao acima, que sao um conjunto fixo de codigos
// por papel, a permissao de tela e identificada pelo proprio endereco da tela
// (`tela:/dashboard/contas-pagar`). Nao ha lista paralela pra manter: a lista
// de telas do sistema ja e o menu.
//
// E ela e LIBERADA POR PADRAO, para qualquer papel. Isso e uma decisao, nao um
// descuido: quando este controle entrou, ninguem podia perder de um dia pro
// outro uma tela que ja usava. Bloquear e sempre uma excecao explicita que o
// gestor marca na tela de Usuarios.
export const PREFIXO_TELA = 'tela:'

export function codigoDaTela(href: string): string {
  return `${PREFIXO_TELA}${href}`
}

export function ehPermissaoDeTela(codigo: string): boolean {
  return codigo.startsWith(PREFIXO_TELA)
}

/**
 * O valor padrao de uma permissao, antes das excecoes do usuario.
 * Tela: sempre liberada. Acao: depende do papel.
 */
export function padraoDaPermissao(papel: Papel | null | undefined, codigo: string): boolean {
  if (ehPermissaoDeTela(codigo)) return true
  return permissoesDoPapel(papel).includes(codigo as PermissaoCodigo)
}

/** Telas que este usuario NAO pode abrir (so as bloqueadas de propósito). */
export function telasBloqueadas(excecoes: Excecoes = {}): string[] {
  return Object.entries(excecoes)
    .filter(([codigo, permitido]) => ehPermissaoDeTela(codigo) && permitido === false)
    .map(([codigo]) => codigo.slice(PREFIXO_TELA.length))
}

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
