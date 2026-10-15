export function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

// ANÚNCIO COM VARIAÇÃO: preço e estoque moram em cada variação. Os do
// próprio anúncio a Shopee deixa zerados — medido em 15/10/2026: "Torneira 2
// Saídas" aparecia R$ 0,00, estoque 0 e "Diverge do produto", com a única
// variação a R$ 49,89 e 99 unidades no canal.
export function resumoDasVariacoes(a: any): { precoMin: number; precoMax: number; estoque: number } | null {
  const vs = a.tem_variacao ? (a.marketplace_anuncio_variacoes ?? []) : []
  const precos = vs.map((v: any) => Number(v.preco)).filter((n: number) => n > 0)
  if (vs.length === 0) return null
  return {
    precoMin: precos.length ? Math.min(...precos) : 0,
    precoMax: precos.length ? Math.max(...precos) : 0,
    estoque: vs.reduce((s: number, v: any) => s + (Number(v.estoque) || 0), 0),
  }
}

// Um anúncio só "diverge" se estiver vinculado a um produto — sem vínculo
// não há com o que comparar preço/estoque. Com variação, compara cada
// variação vinculada com o produto DELA.
export function temDivergencia(a: any): boolean {
  if (a.tem_variacao && (a.marketplace_anuncio_variacoes ?? []).length > 0) {
    return (a.marketplace_anuncio_variacoes as any[]).some(v => v.produto_id && v.produtos && (
      Number(v.preco) !== Number(v.produtos.preco_venda) || (Number(v.estoque) || 0) !== (Number(v.produtos.estoque) || 0)))
  }
  if (!a.produto_id || !a.produtos) return false
  const precoDiverge = Number(a.preco_venda) !== Number(a.produtos.preco_venda)
  const estoqueDiverge = (a.estoque_externo ?? 0) !== (a.produtos.estoque ?? 0)
  return precoDiverge || estoqueDiverge
}

// Etapa operacional pra exibição (abas da tela de Pedidos) — calculada no
// cliente a partir de dados já existentes, sem persistir nada novo.
// Estados terminais (enviado/concluído/cancelado/com_pendencia) vêm direto
// de `etapa_interna` (calculado no servidor durante o sync) e têm
// prioridade; os estados "em andamento" são recalculados aqui sempre que o
// componente renderiza, então refletem mapeamento/NF-e/etiqueta na hora,
// sem depender de um novo sync pra "destravar".
export type EtapaExibicao = 'reservar' | 'mapear' | 'emitir' | 'enviar' | 'imprimir' | 'enviado' | 'concluido' | 'cancelado' | 'com_pendencia'

const LIMITE_RESERVA_DIAS = 2

export function calcularEtapaExibicao(pedido: any): EtapaExibicao {
  if (pedido.etapa_interna === 'cancelado' || pedido.etapa_interna === 'concluido' || pedido.etapa_interna === 'enviado' || pedido.etapa_interna === 'com_pendencia') {
    return pedido.etapa_interna
  }

  const itens = pedido.marketplace_pedido_itens ?? []
  if (itens.some((i: any) => !i.produto_id)) return 'mapear'

  const pacote = pedido.marketplace_pedido_pacotes?.[0]
  if (pacote?.status_etiqueta === 'pronta') return 'imprimir'
  if (pedido.nfe_informada_em) return 'enviar'

  if (pedido.prazo_postagem) {
    const diasAtePrazo = (new Date(pedido.prazo_postagem).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    if (diasAtePrazo > LIMITE_RESERVA_DIAS) return 'reservar'
  }

  return 'emitir'
}

export const ETAPA_EXIBICAO_LABEL: Record<EtapaExibicao, string> = {
  reservar: 'Reservar', mapear: 'Mapear', emitir: 'Para Emitir', enviar: 'A Enviar', imprimir: 'Imprimir',
  enviado: 'Enviado', concluido: 'Concluído', cancelado: 'Cancelado', com_pendencia: 'Com pendência',
}

// "Pedidos do dia" — data_pedido caiu no calendário local de hoje.
export function ehHoje(dataIso: string | null): boolean {
  if (!dataIso) return false
  const d = new Date(dataIso)
  const hoje = new Date()
  return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth() && d.getDate() === hoje.getDate()
}

export const ETAPA_EXIBICAO_CORES: Record<EtapaExibicao, string> = {
  reservar: 'bg-slate-100 text-slate-600',
  mapear: 'bg-amber-100 text-amber-700',
  emitir: 'bg-indigo-100 text-indigo-700',
  enviar: 'bg-teal-100 text-teal-700',
  imprimir: 'bg-cyan-100 text-cyan-700',
  enviado: 'bg-cyan-100 text-cyan-700',
  concluido: 'bg-green-100 text-green-800',
  cancelado: 'bg-gray-100 text-gray-500',
  com_pendencia: 'bg-red-100 text-red-600',
}
