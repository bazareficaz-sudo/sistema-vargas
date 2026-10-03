import { mlGet } from './client'
import type { MLChannel } from './types'

// Dados de faturamento do comprador (CPF/CNPJ, nome, endereço, IE) de um
// pedido do Mercado Livre — o pedido em si não traz nada disso, e a NF-e não
// sai sem. Interpretação da resposta: destinatarioMercadoLivre() em
// src/lib/fiscal/destinatario.ts.
//
// Dois caminhos, nesta ordem:
//   1. GET /orders/{id}/billing_info com `x-version: 2` — uma chamada só;
//   2. o fluxo novo que o ML recomenda: o id do billing_info vem no pedido
//      (GET /orders/{id}) e os dados em /orders/billing-info/MLB/{id}.
// O primeiro está marcado como legado na documentação; o segundo é o
// substituto. Tentar os dois evita que a emissão pare no dia em que o
// legado sair do ar.
export async function buscarDadosFaturamentoML(canal: MLChannel, orderId: string): Promise<any> {
  let erroLegado: unknown
  try {
    return await mlGet(`/orders/${orderId}/billing_info`, {}, canal.accessToken, { 'x-version': '2' })
  } catch (e) {
    erroLegado = e
  }

  const pedido = await mlGet(`/orders/${orderId}`, {}, canal.accessToken)
  const billingId = pedido?.buyer?.billing_info?.id ?? pedido?.billing_info?.id
  if (!billingId) throw erroLegado
  return mlGet(`/orders/billing-info/MLB/${billingId}`, {}, canal.accessToken)
}
