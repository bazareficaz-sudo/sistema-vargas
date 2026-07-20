// Chaves usadas pelo terminal VargasNexus PDV (vargasnexus-pdv/src/renderer/app.js,
// função podePermissao). Não renomear as já existentes sem atualizar o app do PDV.
export type PermissoesPdv = Record<string, boolean>

export interface PermissaoItem {
  key: string
  label: string
}

export interface PermissaoCategoria {
  label: string
  itens: PermissaoItem[]
}

export const CATEGORIAS_PERMISSOES: PermissaoCategoria[] = [
  {
    label: 'Visualização',
    itens: [
      { key: 'ver_custo_produtos', label: 'Ver custo dos produtos' },
      { key: 'ver_lucro_margem', label: 'Ver lucro e margem' },
      { key: 'ver_total_vendas_dia', label: 'Ver total de vendas do dia' },
      { key: 'ver_vendas_todos_terminais', label: 'Ver vendas de todos os terminais' },
      { key: 'ver_saude_pedido', label: 'Ver saúde do pedido' },
    ],
  },
  {
    label: 'Caixa',
    itens: [
      { key: 'ver_fechamento_caixa', label: 'Ver fechamento de caixa' },
      { key: 'abrir_caixa', label: 'Abrir caixa' },
      { key: 'fechar_caixa', label: 'Fechar caixa' },
      { key: 'fazer_sangria', label: 'Fazer sangria' },
      { key: 'lancar_suprimento', label: 'Lançar suprimento' },
    ],
  },
  {
    label: 'Vendas',
    itens: [
      { key: 'alterar_preco_venda', label: 'Alterar preço de venda' },
      { key: 'dar_desconto_pdv', label: 'Dar desconto no PDV' },
      { key: 'autorizar_desconto_acima_limite', label: 'Autorizar desconto acima do limite' },
      { key: 'vender_abaixo_preco_minimo', label: 'Vender abaixo do preço mínimo' },
      { key: 'cancelar_venda', label: 'Cancelar venda' },
      { key: 'excluir_venda', label: 'Excluir venda' },
      { key: 'reimprimir_comprovante', label: 'Reimprimir comprovante' },
      { key: 'criar_orcamentos', label: 'Criar orçamentos' },
    ],
  },
  {
    label: 'Financeiro',
    itens: [
      { key: 'receber_contas_clientes', label: 'Receber contas de clientes' },
    ],
  },
  {
    label: 'Cadastros',
    itens: [
      { key: 'cadastrar_produto_pdv', label: 'Cadastrar produto no PDV' },
      { key: 'cadastrar_cliente_pdv', label: 'Cadastrar cliente no PDV' },
    ],
  },
  {
    label: 'Pedidos',
    itens: [
      { key: 'editar_pedido', label: 'Editar pedido' },
      { key: 'excluir_pedido', label: 'Excluir pedido' },
    ],
  },
  {
    label: 'Marketplace',
    itens: [
      { key: 'ver_marketplace', label: 'Acessar seção Marketplace' },
      { key: 'gerenciar_anuncios', label: 'Gerenciar anúncios' },
      { key: 'sincronizar_marketplace', label: 'Sincronizar estoque/preço com canais' },
    ],
  },
]

export const TODAS_PERMISSOES: PermissaoItem[] = CATEGORIAS_PERMISSOES.flatMap(c => c.itens)

export function contarPermissoesAtivas(permissoes: PermissoesPdv | null | undefined): number {
  if (!permissoes) return 0
  return TODAS_PERMISSOES.reduce((n, p) => n + (permissoes[p.key] ? 1 : 0), 0)
}

export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
