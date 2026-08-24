// Registry of all system modules with their keys, labels, and associated routes.
// The `modulo` key in this file must match what is stored in `plan_modules.modulo`.

export const SYSTEM_MODULES = {
  dashboard:            { label: 'Dashboard',                routes: ['/dashboard'] },
  pdv:                  { label: 'PDV',                      routes: ['/pdv'] },
  vendas:               { label: 'Vendas',                   routes: ['/dashboard/vendas'] },
  orcamentos:           { label: 'Orçamentos',               routes: ['/dashboard/orcamentos'] },
  incentivos:           { label: 'Incentivos',               routes: ['/dashboard/incentivos'] },
  saude_venda:          { label: 'Saúde da Venda',           routes: ['/dashboard/configuracoes/saude-venda'] },
  automacoes:           { label: 'Automações',               routes: ['/dashboard/automacoes'] },
  produtos:             { label: 'Produtos',                 routes: ['/dashboard/produtos'] },
  clientes:             { label: 'Clientes',                 routes: ['/dashboard/clientes'] },
  fornecedores:         { label: 'Fornecedores',             routes: ['/dashboard/fornecedores'] },
  categorias:           { label: 'Categorias',               routes: ['/dashboard/categorias'] },
  marcas:               { label: 'Marcas',                   routes: ['/dashboard/marcas'] },
  vendedores:           { label: 'Vendedores',               routes: ['/dashboard/vendedores'] },
  estoque:              { label: 'Estoque',                  routes: ['/dashboard/estoque', '/dashboard/depositos'] },
  entradas:             { label: 'Compras / Entradas',       routes: ['/dashboard/entradas'] },
  entradas_xml:         { label: 'Entrada por XML / NF-e',   routes: ['/dashboard/entradas-xml'] },
  pedidos_compra:       { label: 'Pedido ao Fornecedor',     routes: ['/dashboard/pedidos-compra'] },
  depositos:            { label: 'Depósitos',                routes: ['/dashboard/depositos'] },
  inventario:           { label: 'Inventário',               routes: ['/dashboard/inventario'] },
  precos:               { label: 'Tabelas de Preço',         routes: ['/dashboard/precos'] },
  financeiro:           { label: 'Financeiro',               routes: ['/dashboard/financeiro'] },
  contas_pagar:         { label: 'Contas a Pagar',           routes: ['/dashboard/contas-pagar'] },
  contas_receber:       { label: 'Contas a Receber',         routes: ['/dashboard/contas-receber'] },
  relatorios:           { label: 'Relatórios',               routes: ['/dashboard/relatorios'] },
  relatorios_avancados: { label: 'Relatórios Avançados / BI', routes: ['/dashboard/relatorios/vendas', '/dashboard/relatorios/produtos', '/dashboard/relatorios/estoque', '/dashboard/relatorios/financeiro', '/dashboard/relatorios/clientes'] },
  marketplace:          { label: 'Marketplace',              routes: ['/dashboard/marketplaces'] },
  loja_online:          { label: 'Loja Online',              routes: ['/dashboard/loja-online'] },
  whatsapp:             { label: 'WhatsApp / CRM',           routes: ['/dashboard/whatsapp', '/dashboard/crm'] },
  usuarios:             { label: 'Usuários e Permissões',    routes: ['/dashboard/usuarios'] },
  multiempresa:         { label: 'Multi-empresa',            routes: ['/dashboard/empresas'] },
  configuracoes:        { label: 'Configurações',            routes: ['/dashboard/configuracoes'] },
  api:                  { label: 'API Externa',              routes: ['/dashboard/api'] },
} as const

export type ModuloKey = keyof typeof SYSTEM_MODULES

// Resolve which module key governs a given pathname
export function moduloParaRota(pathname: string): ModuloKey | null {
  for (const [key, cfg] of Object.entries(SYSTEM_MODULES) as [ModuloKey, { routes: readonly string[] }][]) {
    if (cfg.routes.some(r => pathname === r || pathname.startsWith(r + '/'))) return key
  }
  return null
}
