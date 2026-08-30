import { baixarEstoquePedidoItem } from '@/lib/produtos/estoque'
import type { Etapa } from './etapas'

// O ciclo da reserva de estoque do pedido da loja.
//
// ── O buraco que este arquivo fecha ──────────────────────────
//
// `loja_criar_pedido` reserva o estoque. `estoque_reserva_consumir` e
// `estoque_reserva_liberar` existiam desde a Fase 2 — e NINGUÉM as chamava.
// A reserva ficava presa até expirar, e o pedido da loja nunca baixava
// estoque, porque `baixarEstoquePedidoItem` só era acionado pelos syncs de
// plataforma (ML, Shopee, Nuvemshop) e a loja não tem sync.
//
// ── Onde ele se pendura, e por que ali ───────────────────────
//
// Em `/api/pedidos/etapa`, que já é o ÚNICO lugar onde a etapa de um pedido
// muda, e que já registra o evento em `pedido_eventos`. Pendurar aqui
// significa que a reserva acompanha o pedido por construção — e não porque
// alguém lembrou de chamar a função certa em mais um lugar.
//
// ── Em que etapa o estoque sai ───────────────────────────────
//
// Em 'separando'. Não é escolha estética: é quando alguém vai à prateleira
// pegar a mercadoria, e a partir dali ela não está mais lá. Nos marketplaces
// a baixa acontece quando a plataforma diz "pago", mas a loja não tem sinal
// de pagamento — o pagamento é na entrega. Esperar 'despachado' deixaria o
// estoque mentindo durante toda a separação.
//
// ── E se falhar ──────────────────────────────────────────────
//
// A etapa JÁ mudou quando isto roda. Um erro aqui não pode desfazer a etapa
// nem estourar a requisição: a expedição precisa continuar. O que ele faz é
// devolver o aviso, para a tela dizer que o estoque não baixou — que é bem
// diferente de fingir que baixou.

export const REFERENCIA_LOJA = 'loja_pedido'

/** Um pedido é da loja quando nasceu no checkout dela. */
export function ehPedidoDaLoja(dadosBrutos: unknown): boolean {
  const d = (dadosBrutos ?? {}) as Record<string, unknown>
  return d.origem === 'loja_online'
}

export type EfeitoReserva = { baixou: number; erros: string[]; liberou: number; consumiu: number }

/**
 * Aplica ao estoque o que a nova etapa significa.
 *
 * Idempotente por construção: a baixa é reivindicada item a item por
 * `baixou_estoque` (ver `baixarEstoquePedidoItem`), e consumir ou liberar
 * reserva já encerrada não afeta linha nenhuma. Isso importa porque uma
 * etapa pode ser remarcada — alguém volta para 'separando' depois de um
 * engano, e não pode baixar o estoque duas vezes.
 */
export async function aplicarEfeitoDaEtapa(
  // O cliente Supabase circula sem tipo neste projeto (ver
  // `baixarEstoquePedidoItem`, que recebe o mesmo). Tipá-lo só aqui obrigaria
  // a converter na chamada, e a conversão esconderia mais do que revela.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  pedidoId: string,
  etapa: Etapa,
  motivo?: string,
): Promise<EfeitoReserva> {
  const efeito: EfeitoReserva = { baixou: 0, erros: [], liberou: 0, consumiu: 0 }

  const { data: pedido } = await sb
    .from('marketplace_pedidos')
    .select('id, dados_brutos, marketplace_pedido_itens(id, baixou_estoque)')
    .eq('id', pedidoId)
    .maybeSingle()

  if (!pedido || !ehPedidoDaLoja(pedido.dados_brutos)) return efeito

  // ── Cancelado: o estoque volta para a vitrine ────────────
  if (etapa === 'cancelado') {
    const { data } = await sb.rpc('estoque_reserva_liberar', {
      p_referencia_tipo: REFERENCIA_LOJA,
      p_referencia_id: pedidoId,
      p_motivo: motivo?.trim() || 'Pedido cancelado',
    })
    efeito.liberou = Number(data ?? 0)
    return efeito
  }

  if (etapa !== 'separando') return efeito

  // ── Separando: a mercadoria sai da prateleira ────────────
  const itens = (pedido.marketplace_pedido_itens ?? []) as { id: string; baixou_estoque: boolean }[]
  for (const item of itens.filter(i => !i.baixou_estoque)) {
    const r = await baixarEstoquePedidoItem(sb, item.id)
    if (r.ok) { if (!r.jaProcessado) efeito.baixou++ } else { efeito.erros.push(r.motivo) }
  }

  // A reserva é consumida mesmo se algum item falhou na baixa: o que ela
  // segurava agora está refletido no estoque físico dos que baixaram, e
  // manter a reserva viva descontaria a mesma mercadoria duas vezes. O que
  // falhou vira pendência do pedido, e é isso que `erros` leva para a tela.
  const { data } = await sb.rpc('estoque_reserva_consumir', {
    p_referencia_tipo: REFERENCIA_LOJA,
    p_referencia_id: pedidoId,
  })
  efeito.consumiu = Number(data ?? 0)

  return efeito
}
