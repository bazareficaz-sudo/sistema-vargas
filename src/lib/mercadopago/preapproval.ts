import { mpRequest } from './client'

// Cria o plano recorrente no Mercado Pago (POST /preapproval_plan) — chamado
// uma única vez por plano, quando o admin vincula a cobrança em
// saas-admin/planos. Retorna o id que vira plans.mercadopago_plan_id.
export async function criarPreapprovalPlan(plano: { nome: string; preco_mensal: number }, backUrl: string): Promise<string> {
  const data = await mpRequest('POST', '/preapproval_plan', {
    reason: `Sistema Vargas — Plano ${plano.nome}`,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: plano.preco_mensal,
      currency_id: 'BRL',
    },
    back_url: backUrl,
  })
  return data.id
}

// Link de checkout do plano — confirmado ao vivo contra a API que
// POST /preapproval com preapproval_plan_id EXIGE card_token_id (não dá pra
// criar a assinatura do nosso lado sem um form de cartão tokenizado no
// front-end). O fluxo real de redirecionamento pra "assinatura com plano
// associado" é mais simples: manda o cliente direto pra essa URL (que já
// vem pronta na resposta de criarPreapprovalPlan) — o Mercado Pago hospeda
// tudo e cria a preapproval sozinho quando o pagador autoriza. Query params
// como payer_email/external_reference são ignorados por essa página
// (confirmado ao vivo) — por isso o webhook casa por payer_email depois.
export function checkoutUrlDoPlano(mercadopagoPlanId: string): string {
  return `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=${mercadopagoPlanId}`
}

// Busca o status oficial de uma preapproval — usado pelo webhook em vez de
// confiar no corpo da notificação (prática recomendada pelo Mercado Pago).
export async function buscarPreapproval(id: string): Promise<any> {
  return mpRequest('GET', `/preapproval/${id}`)
}

// Lista as preapprovals já criadas pra um plano — usado pra reconciliação
// manual (ver /api/mercadopago/confirmar-assinatura). Confirmado ao vivo que
// a resposta de /preapproval/{id} vem com payer_email vazio nesse fluxo de
// checkout hospedado, então casar pagamento com assinatura pelo e-mail do
// pagador (como o webhook tentava fazer) não funciona — a reconciliação por
// "assinatura pendente + único candidato autorizado desse plano" é o que
// efetivamente linka o pagamento à conta certa.
export async function buscarPreapprovalsPorPlano(planoId: string): Promise<any[]> {
  const data = await mpRequest('GET', `/preapproval/search?preapproval_plan_id=${planoId}`)
  return data?.results ?? []
}

// Histórico de cobranças de uma assinatura — usado na tela "Minha
// Assinatura" pro cliente ver as faturas. Confirmado ao vivo que esse
// endpoint devolve cada cobrança recorrente com status do pagamento.
export async function listarPagamentos(preapprovalId: string): Promise<any[]> {
  const data = await mpRequest('GET', `/authorized_payments/search?preapproval_id=${preapprovalId}`)
  return data?.results ?? []
}
