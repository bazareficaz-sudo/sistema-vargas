import type { PlanData } from '@/lib/plans/types'

// ─── Estrutura do menu ────────────────────────────────────────────────────────

export type NavItem = { href: string; label: string; icon?: string; modulo?: string }
export type SubGroup = { label: string; items: NavItem[] }
export type NavGroup = {
  id: string
  label: string
  icon: string
  color: string
  textColor: string
  badgeColor: string
  badge?: string
  modulo?: string       // se definido, o grupo inteiro é bloqueado se o módulo não estiver no plano
  items?: NavItem[]
  subGroups?: SubGroup[]
  defaultOpen?: boolean
}

export const NAV: NavGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '⊞',
    color: 'bg-slate-700',
    textColor: 'text-blue-300',
    badgeColor: 'bg-blue-500',
    defaultOpen: true,
    items: [
      { href: '/dashboard',                        label: 'Visão Geral',          icon: '🏠' },
      { href: '/dashboard/relatorios',             label: 'Indicadores BI',       icon: '📊', modulo: 'relatorios' },
      { href: '/dashboard/relatorios/alertas',     label: 'Alertas Inteligentes', icon: '🔔', modulo: 'relatorios_avancados' },
      { href: '/dashboard/assinatura',             label: 'Minha Assinatura',     icon: '💳' },
    ],
  },
  {
    id: 'comercial',
    label: 'Comercial',
    icon: '🛒',
    color: 'bg-blue-900',
    textColor: 'text-blue-300',
    badgeColor: 'bg-blue-500',
    defaultOpen: true,
    items: [
      { href: '/pdv',                              label: 'PDV',                icon: '🖥',  modulo: 'pdv' },
      // Centro de pedidos: reúne vendas do PDV e pedidos de marketplace numa
      // lista só. Fica ANTES de Vendas de propósito — é a visão completa.
      { href: '/dashboard/pedidos',                label: 'Pedidos',            icon: '📦',  modulo: 'vendas' },
      { href: '/dashboard/vendas',                 label: 'Vendas',             icon: '💳',  modulo: 'vendas' },
      { href: '/dashboard/orcamentos',             label: 'Orçamentos',         icon: '📋',  modulo: 'orcamentos' },
      { href: '/dashboard/incentivos',             label: 'Incentivos',         icon: '🏆',  modulo: 'incentivos' },
      { href: '/dashboard/configuracoes/saude-venda', label: 'Saúde da Venda', icon: '💚', modulo: 'saude_venda' },
    ],
  },
  {
    id: 'cadastros',
    label: 'Cadastros',
    icon: '📁',
    color: 'bg-violet-900',
    textColor: 'text-violet-300',
    badgeColor: 'bg-violet-500',
    defaultOpen: false,
    subGroups: [
      {
        label: 'Produtos',
        items: [
          { href: '/dashboard/produtos',    label: 'Produtos',    icon: '📦', modulo: 'produtos' },
          { href: '/dashboard/categorias',  label: 'Categorias',  icon: '🗂', modulo: 'categorias' },
          { href: '/dashboard/marcas',      label: 'Marcas',      icon: '🏷', modulo: 'marcas' },
        ],
      },
      {
        label: 'Pessoas',
        items: [
          { href: '/dashboard/clientes',     label: 'Clientes',     icon: '👥', modulo: 'clientes' },
          { href: '/dashboard/fornecedores', label: 'Fornecedores', icon: '🏭', modulo: 'fornecedores' },
          { href: '/dashboard/vendedores',   label: 'Vendedores',   icon: '🤝', modulo: 'vendedores' },
        ],
      },
      {
        label: 'Preços',
        items: [
          { href: '/dashboard/precos', label: 'Tabelas de Preço', icon: '💲', modulo: 'precos' },
        ],
      },
    ],
  },
  {
    id: 'estoque',
    label: 'Estoque',
    icon: '📦',
    color: 'bg-amber-900',
    textColor: 'text-amber-300',
    badgeColor: 'bg-amber-500',
    modulo: 'estoque',
    defaultOpen: false,
    items: [
      { href: '/dashboard/relatorios/estoque',     label: 'Visão do Estoque',   icon: '📊', modulo: 'relatorios_avancados' },
      { href: '/dashboard/depositos',              label: 'Depósitos',           icon: '🏭', modulo: 'depositos' },
      { href: '/dashboard/movimentacoes-estoque',  label: 'Movimentação de Estoque', icon: '📑', modulo: 'depositos' },
      { href: '/dashboard/inventarios',            label: 'Inventário',          icon: '🔢', modulo: 'inventario' },
      { href: '/dashboard/entradas',               label: 'Entradas',            icon: '📥', modulo: 'entradas' },
      { href: '/dashboard/entradas/produtos',      label: 'Produtos Comprados',  icon: '🛍', modulo: 'entradas' },
      { href: '/dashboard/etiquetas/emitir',       label: 'Emitir Etiquetas',    icon: '🏷️' },
      { href: '/dashboard/etiquetas/modelos',      label: 'Modelos de Etiqueta', icon: '📐' },
    ],
  },
  {
    id: 'compras',
    label: 'Compras',
    icon: '🛍',
    color: 'bg-orange-900',
    textColor: 'text-orange-300',
    badgeColor: 'bg-orange-500',
    defaultOpen: false,
    items: [
      { href: '/dashboard/auxiliar-compras',        label: 'Auxiliar de Compras',  icon: '🧭', modulo: 'pedidos_compra' },
      { href: '/dashboard/auxiliar-compras/faltas', label: 'Faltas e Encomendas', icon: '📌', modulo: 'pedidos_compra' },
      { href: '/dashboard/pedidos-compra',  label: 'Pedido ao Fornecedor', icon: '📋', modulo: 'pedidos_compra' },
      { href: '/dashboard/entradas/nova',   label: 'Nova Entrada',         icon: '➕', modulo: 'entradas' },
      { href: '/dashboard/entradas-xml',    label: 'XML / NF-e',           icon: '📄', modulo: 'entradas_xml' },
      { href: '/dashboard/fornecedores',    label: 'Fornecedores',         icon: '🏭', modulo: 'fornecedores' },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    icon: '💰',
    color: 'bg-emerald-900',
    textColor: 'text-emerald-300',
    badgeColor: 'bg-emerald-500',
    defaultOpen: false,
    subGroups: [
      {
        label: 'Visão Geral',
        items: [
          { href: '/dashboard/financeiro', label: 'Hub Financeiro', icon: '⚖️', modulo: 'financeiro' },
        ],
      },
      {
        label: 'Receber',
        items: [
          { href: '/dashboard/contas-receber',    label: 'Contas a Receber', icon: '💰', modulo: 'contas_receber' },
          { href: '/dashboard/carteira-clientes', label: 'Carteira de Clientes', icon: '🗂️', modulo: 'contas_receber' },
          { href: '/dashboard/cobranca',          label: 'Cobranças',        icon: '📞', modulo: 'contas_receber' },
          { href: '/dashboard/creditos-clientes', label: 'Créditos',         icon: '🎫', modulo: 'financeiro' },
        ],
      },
      {
        label: 'Pagar',
        items: [
          { href: '/dashboard/contas-pagar', label: 'Contas a Pagar', icon: '💳', modulo: 'contas_pagar' },
          { href: '/dashboard/contas-pagar/relatorio', label: 'Relatório de Pagamentos', icon: '📊', modulo: 'contas_pagar' },
        ],
      },
      {
        label: 'Relatórios',
        items: [
          { href: '/dashboard/relatorios/financeiro', label: 'Fluxo Financeiro', icon: '📈', modulo: 'relatorios_avancados' },
        ],
      },
    ],
  },
  {
    id: 'marketplaces',
    label: 'Marketplaces',
    icon: '🏪',
    color: 'bg-pink-900',
    textColor: 'text-pink-300',
    badgeColor: 'bg-pink-500',
    modulo: 'marketplace',
    defaultOpen: false,
    items: [
      { href: '/dashboard/marketplaces', label: 'Marketplaces', icon: '🏪', modulo: 'marketplace' },
      { href: '/dashboard/marketplaces/anuncios', label: 'Anúncios', icon: '📢', modulo: 'marketplace' },
      { href: '/dashboard/mapa-anuncios', label: 'Mapa de Anúncios', icon: '🗺️', modulo: 'marketplace' },
          { href: '/dashboard/marketplaces/fila', label: 'Fila de Atualização', icon: '🔄', modulo: 'marketplace' },
      { href: '/dashboard/anuncios-rascunhos', label: 'Anúncios Rascunhos', icon: '🧩', modulo: 'marketplace' },
      { href: '/dashboard/precificacao', label: 'Precificação', icon: '🎯', modulo: 'marketplace' },
      { href: '/dashboard/pedidos-ecommerce', label: 'Pedidos', icon: '📦', modulo: 'marketplace' },
    ],
  },
  {
    id: 'crm',
    label: 'CRM / WhatsApp',
    icon: '💬',
    color: 'bg-teal-900',
    textColor: 'text-teal-300',
    badgeColor: 'bg-teal-500',
    modulo: 'whatsapp',
    defaultOpen: false,
    items: [
      { href: '/dashboard/integracoes/whatsapp',           label: 'WhatsApp / Z-API', icon: '📱', modulo: 'whatsapp' },
      { href: '/dashboard/integracoes/whatsapp/historico', label: 'Histórico',        icon: '📋', modulo: 'whatsapp' },
    ],
  },
  {
    id: 'relatorios',
    label: 'Relatórios & BI',
    icon: '📈',
    color: 'bg-indigo-900',
    textColor: 'text-indigo-300',
    badgeColor: 'bg-indigo-500',
    defaultOpen: false,
    modulo: 'relatorios',
    items: [
      { href: '/dashboard/relatorios',             label: 'Dashboard Executivo',    icon: '📊', modulo: 'relatorios' },
      { href: '/dashboard/relatorios/vendas',      label: 'Análise de Vendas',      icon: '📈', modulo: 'relatorios_avancados' },
      { href: '/dashboard/relatorios/produtos',    label: 'Produtos & Curva ABC',   icon: '🏆', modulo: 'relatorios_avancados' },
      { href: '/dashboard/relatorios/estoque',     label: 'Estoque & Giro',         icon: '📦', modulo: 'relatorios_avancados' },
      { href: '/dashboard/relatorios/financeiro',  label: 'Fluxo Financeiro',       icon: '💰', modulo: 'relatorios_avancados' },
      { href: '/dashboard/relatorios/clientes',    label: 'Inteligência Clientes',  icon: '👥', modulo: 'relatorios_avancados' },
      { href: '/dashboard/relatorios/alertas',     label: 'Alertas Inteligentes',   icon: '🔔', modulo: 'relatorios_avancados' },
    ],
  },
  {
    id: 'automacoes',
    label: 'Automações',
    icon: '⚡',
    color: 'bg-yellow-900',
    textColor: 'text-yellow-300',
    badgeColor: 'bg-yellow-500',
    defaultOpen: false,
    items: [
      { href: '/dashboard/automacoes', label: 'Central de Automações', icon: '⚡', modulo: 'automacoes' },
    ],
  },
  {
    id: 'gestao',
    label: 'Gestão',
    icon: '⚙️',
    color: 'bg-slate-800',
    textColor: 'text-slate-300',
    badgeColor: 'bg-slate-500',
    // Sem `modulo` no grupo nem nos itens abaixo (exceto Usuários do PDV) de
    // propósito: configurar a própria empresa, dados fiscais/certificado e
    // quem acessa o sistema não é recurso "premium" — todo plano precisa,
    // independente de quais módulos operacionais (vendas, marketplace etc.)
    // estejam incluídos. Um plano enxuto como o "Fiscal" (só contas a pagar/
    // entradas XML/fornecedores) ficava sem conseguir configurar o próprio
    // certificado — bug real, corrigido aqui.
    defaultOpen: false,
    items: [
      { href: '/dashboard/empresas',                  label: 'Empresas',        icon: '🏢' },
      { href: '/dashboard/empresas/parcerias',        label: 'Parcerias',       icon: '🤝' },
      { href: '/dashboard/configuracoes/usuarios',    label: 'Usuários',        icon: '👤' },
      { href: '/dashboard/usuarios-pdv',               label: 'Usuários do PDV', icon: '🔐', modulo: 'pdv' },
      { href: '/dashboard/configuracoes/integracoes', label: 'Integrações',     icon: '🔌' },
      { href: '/dashboard/configuracoes/compras',     label: 'Compras e Custos', icon: '📥' },
      { href: '/dashboard/configuracoes/estoque-unificado', label: 'Estoque do Grupo', icon: '🔗' },
      { href: '/dashboard/configuracoes/impressao',   label: 'Impressão',       icon: '🖨️' },
      { href: '/dashboard/configuracoes/anuncios',    label: 'Padrão de anúncios', icon: '✨' },
      { href: '/dashboard/configuracoes/aparencia',   label: 'Aparência',       icon: '🎨' },
    ],
  },
]

// Achata todos os itens para busca e recentes
export function allItems(): (NavItem & { group: string })[] {
  const out: (NavItem & { group: string })[] = []
  for (const g of NAV) {
    for (const it of g.items ?? []) out.push({ ...it, group: g.label })
    for (const sg of g.subGroups ?? []) {
      for (const it of sg.items) out.push({ ...it, group: `${g.label} › ${sg.label}` })
    }
  }
  return out
}
export const ALL_ITEMS = allItems()

// ─── Helpers puros (compartilhados por Sidebar e TopMenu) ────────────────────

export function temModulo(plan: PlanData, modulo?: string) {
  if (!modulo) return true
  if (plan.isSystemAdmin) return true
  return plan.modulos.includes(modulo)
}

/**
 * Tela bloqueada para este usuário em Usuários → Permissões.
 *
 * Esconder do menu é só conforto: quem digitar o endereço na barra é barrado
 * no layout do dashboard, no servidor. Sem os dois, ou a pessoa vê um item
 * que não abre, ou abre uma tela que não deveria.
 */
export function telaBloqueada(plan: PlanData, href: string) {
  return (plan.telasBloqueadas ?? []).includes(href)
}

export function filtrarItens(plan: PlanData, items: NavItem[]) {
  return items.filter(it => temModulo(plan, it.modulo) && !telaBloqueada(plan, it.href))
}

export function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}
