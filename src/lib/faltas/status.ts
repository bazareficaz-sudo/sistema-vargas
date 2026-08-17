// Vocabulário das faltas e encomendas — um lugar só.
//
// Três programas escrevem nesta tabela: o PDV do balcão, a tela de faltas do
// próprio PDV e, agora, o painel. Enquanto cada um tiver a sua listinha de
// status, um vai gravar `comprado` e o outro vai procurar por `em_compra`, e
// a solicitação some da tela sem ninguém entender por quê.

export type StatusFalta =
  | 'pendente' | 'em_analise' | 'em_compra' | 'pedido' | 'recebido'
  | 'atendido' | 'cancelado'

/** Como a solicitação anda, do balcão até a mercadoria na mão do cliente. */
export const FLUXO: StatusFalta[] = [
  'pendente', 'em_analise', 'em_compra', 'pedido', 'recebido', 'atendido',
]

export const STATUS: Record<string, { label: string; cor: string; ajuda: string }> = {
  pendente:   { label: 'Pendente',   cor: 'bg-amber-100 text-amber-800',     ajuda: 'Anotada no balcão. Ninguém da compra olhou ainda.' },
  em_analise: { label: 'Em análise', cor: 'bg-blue-100 text-blue-700',       ajuda: 'O comprador viu e está avaliando.' },
  em_compra:  { label: 'Na lista',   cor: 'bg-indigo-100 text-indigo-700',   ajuda: 'Entrou numa lista de compra.' },
  pedido:     { label: 'Pedido',     cor: 'bg-violet-100 text-violet-700',   ajuda: 'Virou pedido ao fornecedor.' },
  recebido:   { label: 'Chegou',     cor: 'bg-cyan-100 text-cyan-700',       ajuda: 'A mercadoria chegou — o vendedor já pode avisar o cliente.' },
  atendido:   { label: 'Atendido',   cor: 'bg-emerald-100 text-emerald-700', ajuda: 'O cliente levou.' },
  cancelado:  { label: 'Cancelado',  cor: 'bg-slate-100 text-slate-500',     ajuda: 'Decidimos não comprar.' },

  // Vocabulário antigo. As linhas gravadas antes de agosto/2026 usam estes
  // valores, e o PDV instalado nos terminais ainda pode gravá-los até a
  // próxima atualização chegar em todas as máquinas. Some daqui e o status
  // dessas linhas aparece em branco na tela.
  notificado: { label: 'Notificado (antigo)', cor: 'bg-blue-100 text-blue-700',     ajuda: 'Valor antigo, equivale a "em análise".' },
  comprado:   { label: 'Comprado (antigo)',   cor: 'bg-violet-100 text-violet-700', ajuda: 'Valor antigo, equivale a "pedido".' },
  resolvido:  { label: 'Resolvido (antigo)',  cor: 'bg-emerald-100 text-emerald-700', ajuda: 'Valor antigo, equivale a "atendido".' },
  ignorado:   { label: 'Ignorado (antigo)',   cor: 'bg-slate-100 text-slate-500',   ajuda: 'Valor antigo, equivale a "cancelado".' },
}

/** Aceito na gravação. Os antigos entram para não travar o PDV desatualizado. */
export const STATUS_VALIDOS = Object.keys(STATUS)

/** Ainda espera alguma coisa acontecer. */
export const ABERTOS = [
  'pendente', 'em_analise', 'em_compra', 'pedido', 'recebido',
  'notificado', 'comprado',
]

export function rotulo(status: string) {
  return STATUS[status] ?? { label: status, cor: 'bg-slate-100 text-slate-500', ajuda: '' }
}

export type TipoFalta = 'falta' | 'encomenda'

export const TIPO: Record<TipoFalta, { label: string; icone: string; cor: string }> = {
  falta:     { label: 'Falta',     icone: '🔍', cor: 'bg-slate-100 text-slate-600' },
  encomenda: { label: 'Encomenda', icone: '📌', cor: 'bg-orange-100 text-orange-700' },
}
