// Meio de envio e rastreio do pedido, lidos do que cada marketplace já mandou
// — sem coluna nova: a informação existe, só estava espalhada.
//
//   Mercado Livre → shipment (envio_dados.shipment): logistic.type e
//                   tracking_number. O tipo diz COMO o pacote sai:
//                   xd_drop_off/drop_off = levar à agência, self_service = Flex
//                   (entrega própria), cross_docking = coleta, fulfillment = Full.
//   TikTok Shop   → pedido (dados_brutos): shipping_provider, tracking_number.
//   Shopee        → pacote (dados_brutos.package_list[0]): shipping_carrier;
//                   o rastreio só existe depois de a etiqueta ser gerada.
//
// A listagem não carrega o JSON inteiro: a página extrai estes campos no
// próprio select (envio_logistica, envio_rastreio_ml, tt_*, sh_*).

const TIPO_ML: Record<string, string> = {
  xd_drop_off: 'Mercado Envios · agência',
  drop_off: 'Mercado Envios · agência',
  self_service: 'Mercado Envios Flex',
  cross_docking: 'Mercado Envios · coleta',
  fulfillment: 'Mercado Envios Full',
  default: 'Mercado Envios',
}

export type MeioDeEnvio = { meio: string | null; detalhe: string | null; rastreio: string | null }

export function meioDeEnvio(p: any): MeioDeEnvio {
  const plataforma = p.marketplace_canais?.plataforma
  const pacote = p.marketplace_pedido_pacotes?.[0]
  const rastreioManual = p.codigo_rastreio || pacote?.codigo_rastreio || null

  if (plataforma === 'mercadolivre') {
    const tipo = p.envio_logistica ?? p.envio_dados?.shipment?.logistic?.type ?? null
    return {
      meio: tipo ? (TIPO_ML[tipo] ?? `Mercado Envios (${tipo})`) : null,
      detalhe: tipo === 'self_service' ? 'entrega própria' : null,
      rastreio: p.envio_rastreio_ml ?? p.envio_dados?.shipment?.tracking_number ?? rastreioManual,
    }
  }
  if (plataforma === 'tiktok') {
    const provedor = p.tt_transportadora ?? p.dados_brutos?.shipping_provider ?? null
    return {
      meio: provedor ? String(provedor).replace(/ Brazil$/i, '') : null,
      detalhe: p.tt_opcao_entrega ?? p.dados_brutos?.delivery_option_name ?? null,
      rastreio: p.tt_rastreio ?? p.dados_brutos?.tracking_number ?? rastreioManual,
    }
  }
  if (plataforma === 'shopee') {
    return {
      meio: p.sh_transportadora ?? p.dados_brutos?.package_list?.[0]?.shipping_carrier ?? pacote?.transportadora ?? null,
      detalhe: null,
      rastreio: rastreioManual,
    }
  }
  return { meio: p.transportadora ?? null, detalhe: null, rastreio: rastreioManual }
}

/** "PV-019573" — número sequencial do pedido no sistema. */
export function numeroInterno(p: { numero_interno?: number | null }): string | null {
  return p.numero_interno != null ? `PV-${String(p.numero_interno).padStart(6, '0')}` : null
}

export const NOME_PLATAFORMA: Record<string, string> = {
  mercadolivre: 'Mercado Livre', shopee: 'Shopee', tiktok: 'TikTok Shop', nuvemshop: 'Nuvemshop', loja_online: 'Loja Online',
}
