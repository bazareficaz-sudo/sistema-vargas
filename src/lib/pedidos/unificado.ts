// Modelo de leitura unificado de pedidos.
//
// Hoje o mesmo conceito ("um pedido de um cliente") vive em duas tabelas que
// não conversam: `vendas` (PDV/app, 359 linhas) e `marketplace_pedidos`
// (Shopee/Mercado Livre, 860 linhas). Quem abria a tela de Vendas via um
// terço do movimento real da loja.
//
// Este módulo não mexe em nenhuma das duas — só traduz as duas para um
// formato comum, de leitura. Unificar de verdade (uma tabela só, com ciclo
// de vida próprio) é a fase seguinte; fazer isso agora significaria migrar
// 1.200 registros e mexer em emissão fiscal e baixa de estoque no mesmo
// movimento, o que é risco desnecessário para o ganho desta etapa.

import type { Etapa } from './etapas'

export type OrigemPedido = 'pdv' | 'app' | 'loja' | 'shopee' | 'mercadolivre' | 'manual' | 'outro'

export type StatusFiscal = 'emitida' | 'rejeitada' | 'informada' | 'nao_emitida'

export type PedidoUnificado = {
  id: string
  /** De qual tabela veio — decide para onde o "abrir" leva. */
  fonte: 'venda' | 'marketplace'
  numero: string
  criadoEm: string
  origem: OrigemPedido
  /** Nome da conta/canal ("PDV", "Shp Ouro", "ML Eficaz"). */
  origemNome: string
  clienteNome: string | null
  total: number
  desconto: number
  frete: number
  status: string
  statusRotulo: string
  cancelado: boolean
  fiscal: StatusFiscal
  fiscalNumero: string | null
  transportadora: string | null
  rastreio: string | null
  /** Marketplace: já foi enviado ao cliente? */
  enviado: boolean
  /** O que o SEU galpão fez — separado do status que o canal informa. */
  etapa: Etapa
  etapaEm: string | null
}

export const ORIGEM_ROTULO: Record<OrigemPedido, string> = {
  pdv: 'PDV', app: 'Aplicativo', loja: 'Loja Online', shopee: 'Shopee',
  mercadolivre: 'Mercado Livre', manual: 'Manual', outro: 'Outro',
}

// Cores de badge por origem — a mesma cor em toda a tela, para o operador
// achar a origem pelo canto do olho sem ler o texto.
export const ORIGEM_COR: Record<OrigemPedido, string> = {
  pdv: 'bg-blue-100 text-blue-700',
  app: 'bg-cyan-100 text-cyan-700',
  loja: 'bg-indigo-100 text-indigo-700',
  shopee: 'bg-orange-100 text-orange-700',
  mercadolivre: 'bg-yellow-100 text-yellow-800',
  manual: 'bg-gray-100 text-gray-600',
  outro: 'bg-gray-100 text-gray-600',
}

function origemDoCanalVenda(canal: string | null): OrigemPedido {
  const c = (canal ?? '').toLowerCase()
  if (c === 'pdv') return 'pdv'
  if (c === 'app') return 'app'
  if (c === 'loja' || c === 'loja_online') return 'loja'
  if (c === 'shopee') return 'shopee'
  if (c === 'mercadolivre' || c === 'mercado livre') return 'mercadolivre'
  if (c === 'manual' || c === 'marketplace') return 'manual'
  return c ? 'outro' : 'pdv'
}

const STATUS_MARKETPLACE: Record<string, string> = {
  novo: 'Novo', confirmado: 'Confirmado', enviado: 'Enviado',
  entregue: 'Entregue', cancelado: 'Cancelado',
}

export function vendaParaPedido(v: any): PedidoUnificado {
  const origem = origemDoCanalVenda(v.canal)
  const cancelado = v.status === 'cancelada' || v.status === 'cancelado'
  const fiscal: StatusFiscal =
    v.nfce_status === 'autorizada' ? 'emitida'
    : v.nfce_status === 'rejeitada' || v.nfce_status === 'erro' ? 'rejeitada'
    : 'nao_emitida'

  return {
    id: v.id,
    fonte: 'venda',
    numero: String(v.numero ?? '—'),
    criadoEm: v.created_at,
    origem,
    origemNome: ORIGEM_ROTULO[origem],
    clienteNome: v.cliente_nome ?? (v.clientes?.nome ?? null),
    total: Number(v.total ?? 0),
    desconto: Number(v.desconto ?? v.desconto_total ?? 0),
    frete: 0,
    status: v.status ?? 'concluida',
    statusRotulo: cancelado ? 'Cancelada' : (v.tipo_operacao === 'devolucao' ? 'Devolução' : 'Concluída'),
    cancelado,
    fiscal,
    fiscalNumero: v.nfce_numero ? String(v.nfce_numero) : null,
    transportadora: null,
    rastreio: null,
    enviado: false,
    // Venda de balcão nasce concluída: o cliente saiu com o produto na mão.
    etapa: (v.etapa_operacional ?? (cancelado ? 'cancelado' : 'concluido')) as Etapa,
    etapaEm: v.etapa_operacional_em ?? null,
  }
}

export function marketplaceParaPedido(p: any, plataformaPorCanal: Map<string, string>, nomePorCanal: Map<string, string>): PedidoUnificado {
  const plataforma = (plataformaPorCanal.get(p.canal_id) ?? '').toLowerCase()
  const origem: OrigemPedido =
    plataforma === 'shopee' ? 'shopee'
    : plataforma === 'mercadolivre' ? 'mercadolivre'
    // Pedido da Loja Online nasce em marketplace_pedidos, num canal com
    // plataforma='loja_online' — por isso ele passa por aqui (Fase 3).
    : plataforma === 'loja_online' ? 'loja'
    : 'outro'
  const cancelado = p.status === 'cancelado'

  return {
    id: p.id,
    fonte: 'marketplace',
    numero: String(p.numero_pedido ?? p.id_externo ?? '—'),
    criadoEm: p.data_pedido ?? p.created_at,
    origem,
    origemNome: nomePorCanal.get(p.canal_id) ?? ORIGEM_ROTULO[origem],
    clienteNome: p.cliente_nome ?? null,
    total: Number(p.valor_total ?? 0),
    desconto: Number(p.valor_desconto ?? 0),
    frete: Number(p.valor_frete ?? 0),
    status: p.status ?? 'novo',
    statusRotulo: STATUS_MARKETPLACE[p.status] ?? (p.status ?? '—'),
    cancelado,
    // A nota de pedido de marketplace pode ter sido emitida pelo sistema
    // (venda_id preenchido) ou só informada à mão pelo operador.
    fiscal: p.nfe_numero ? (p.venda_id ? 'emitida' : 'informada') : 'nao_emitida',
    fiscalNumero: p.nfe_numero ? String(p.nfe_numero) : null,
    transportadora: p.transportadora ?? null,
    rastreio: p.codigo_rastreio ?? null,
    enviado: !!p.data_envio || p.status === 'enviado' || p.status === 'entregue',
    etapa: (p.etapa_operacional ?? (cancelado ? 'cancelado' : 'novo')) as Etapa,
    etapaEm: p.etapa_operacional_em ?? null,
  }
}

export type IndicadoresPedidos = {
  quantidade: number
  valor: number
  ticketMedio: number
  aguardandoNota: number
  aguardandoEnvio: number
  cancelados: number
  aSeparar: number
  aDespachar: number
  semCliente: number
  marketplace: number
  pdv: number
}

export function calcularIndicadores(pedidos: PedidoUnificado[]): IndicadoresPedidos {
  // Cancelado não entra em faturamento nem em ticket médio — senão o número
  // do dia sobe com pedido que não vai gerar receita nenhuma.
  const validos = pedidos.filter(p => !p.cancelado)
  const valor = validos.reduce((s, p) => s + p.total, 0)
  return {
    quantidade: validos.length,
    valor,
    ticketMedio: validos.length > 0 ? valor / validos.length : 0,
    aguardandoNota: validos.filter(p => p.fiscal === 'nao_emitida' || p.fiscal === 'rejeitada').length,
    aguardandoEnvio: validos.filter(p => p.fonte === 'marketplace' && !p.enviado).length,
    cancelados: pedidos.filter(p => p.cancelado).length,
    // O que exige ação do galpão agora — a pergunta que a tela de histórico
    // não respondia.
    aSeparar: validos.filter(p => p.etapa === 'novo' || p.etapa === 'separando').length,
    aDespachar: validos.filter(p => p.etapa === 'embalado').length,
    semCliente: validos.filter(p => !p.clienteNome?.trim()).length,
    marketplace: validos.filter(p => p.fonte === 'marketplace').length,
    pdv: validos.filter(p => p.fonte === 'venda').length,
  }
}
