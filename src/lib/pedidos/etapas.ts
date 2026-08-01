// Etapas do pedido — o que o SEU galpão fez com ele.
//
// Não confundir com o status do canal, que diz o que a Shopee ou o Mercado
// Livre sabem. Um pedido pode estar "pago" no ML e ainda não ter sido
// separado aqui; é esse vão que a etapa mostra.

export type Etapa = 'novo' | 'separando' | 'embalado' | 'despachado' | 'concluido' | 'cancelado'

export const ETAPAS: { valor: Etapa; label: string; cor: string; icone: string; ajuda: string }[] = [
  { valor: 'novo',       label: 'Novo',        icone: '🆕', cor: 'bg-blue-100 text-blue-700 border-blue-200',       ajuda: 'Chegou e ninguém encostou ainda.' },
  { valor: 'separando',  label: 'Separando',   icone: '🔎', cor: 'bg-amber-100 text-amber-800 border-amber-200',    ajuda: 'Alguém está buscando os itens.' },
  { valor: 'embalado',   label: 'Embalado',    icone: '📦', cor: 'bg-violet-100 text-violet-700 border-violet-200', ajuda: 'Pronto, esperando a transportadora.' },
  { valor: 'despachado', label: 'Despachado',  icone: '🚚', cor: 'bg-cyan-100 text-cyan-700 border-cyan-200',       ajuda: 'Saiu para entrega.' },
  { valor: 'concluido',  label: 'Concluído',   icone: '✅', cor: 'bg-green-100 text-green-700 border-green-200',    ajuda: 'Entregue e encerrado.' },
  { valor: 'cancelado',  label: 'Cancelado',   icone: '⛔', cor: 'bg-gray-100 text-gray-500 border-gray-200',       ajuda: 'Não vai acontecer.' },
]

export const ETAPA_INFO: Record<Etapa, (typeof ETAPAS)[number]> =
  Object.fromEntries(ETAPAS.map(e => [e.valor, e])) as any

// Ordem de progresso. Cancelado fica fora: é saída, não avanço.
const ORDEM: Etapa[] = ['novo', 'separando', 'embalado', 'despachado', 'concluido']

export function posicaoDaEtapa(e: Etapa): number {
  const i = ORDEM.indexOf(e)
  return i === -1 ? -1 : i
}

export function proximaEtapa(atual: Etapa): Etapa | null {
  const i = posicaoDaEtapa(atual)
  if (i === -1 || i >= ORDEM.length - 1) return null
  return ORDEM[i + 1]
}

// Transição livre entre etapas, com duas restrições que evitam bagunça:
// não sair de cancelado por engano, e não voltar de concluído sem passar
// pelo cancelamento.
export function transicaoPermitida(de: Etapa, para: Etapa): { ok: boolean; motivo?: string } {
  if (de === para) return { ok: false, motivo: 'O pedido já está nessa etapa.' }
  if (de === 'cancelado') return { ok: false, motivo: 'Pedido cancelado não volta ao fluxo. Crie um novo pedido.' }
  if (de === 'concluido' && para !== 'cancelado') {
    return { ok: false, motivo: 'Pedido concluído só pode ser cancelado, não retrocedido.' }
  }
  return { ok: true }
}

// O canal manda no que ele sabe: se a Shopee ou o ML dizem que foi enviado
// ou entregue, a etapa acompanha — mas só para a frente. Quem já registrou
// separação e embalagem não perde esse histórico porque o canal atualizou.
export function etapaPeloStatusDoCanal(statusCanal: string, etapaAtual: Etapa): Etapa | null {
  const s = (statusCanal ?? '').toLowerCase()
  if (s === 'cancelado') return etapaAtual === 'cancelado' ? null : 'cancelado'

  const alvo: Etapa | null = s === 'entregue' ? 'concluido' : s === 'enviado' ? 'despachado' : null
  if (!alvo) return null
  if (etapaAtual === 'cancelado') return null
  return posicaoDaEtapa(alvo) > posicaoDaEtapa(etapaAtual) ? alvo : null
}

export function rotuloEtapa(e: string | null | undefined): string {
  return ETAPA_INFO[(e ?? 'novo') as Etapa]?.label ?? String(e ?? '—')
}
