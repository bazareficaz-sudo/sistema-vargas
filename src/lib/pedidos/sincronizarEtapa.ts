import { ETAPA_INFO, etapaPeloStatusDoCanal, type Etapa } from './etapas'

// Mantém a etapa operacional em dia com o que o canal informa.
//
// Chamado pela sincronização da Shopee e do Mercado Livre logo depois de
// gravar o pedido. Sem isso, um pedido que a Shopee já entregou continuaria
// aparecendo como "a separar" na tela, e a lista viraria ficção.
//
// A regra é de mão única: a etapa só AVANÇA. Se alguém aqui já marcou
// "embalado" e o canal ainda diz "pago", nada acontece — quem trabalhou não
// perde o registro porque o canal está atrasado.

export async function sincronizarEtapaComCanal(
  sb: any,
  params: { pedidoId: string; empresaId: string; statusCanal: string },
): Promise<Etapa | null> {
  const { data: pedido } = await sb.from('marketplace_pedidos')
    .select('etapa_operacional').eq('id', params.pedidoId).maybeSingle()
  if (!pedido) return null

  const atual = (pedido.etapa_operacional ?? 'novo') as Etapa
  const nova = etapaPeloStatusDoCanal(params.statusCanal, atual)
  if (!nova) return null

  const agora = new Date().toISOString()
  await sb.from('marketplace_pedidos')
    .update({ etapa_operacional: nova, etapa_operacional_em: agora })
    .eq('id', params.pedidoId)

  // Fica na linha do tempo marcado como automático, para ninguém procurar
  // qual colega mudou a etapa.
  await sb.from('pedido_eventos').insert({
    empresa_id: params.empresaId,
    fonte: 'marketplace', referencia_id: params.pedidoId,
    tipo: 'etapa',
    etapa_anterior: atual, etapa_nova: nova,
    descricao: `${ETAPA_INFO[atual]?.label ?? atual} → ${ETAPA_INFO[nova].label}`,
    observacao: `O canal informou "${params.statusCanal}".`,
    automatico: true,
  })

  return nova
}
