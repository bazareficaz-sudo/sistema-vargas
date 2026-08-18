// Quais `tipo` de whatsapp_mensagens contam como "cobrança" pra fins do
// toggle por cliente (Cliente > Configuração Financeira > Cobrança
// automática via WhatsApp). Deliberadamente estreito: um pedido confirmado
// ou uma promoção não é cobrança, e não deve parar de chegar só porque o
// cliente pediu pra não ser cobrado — o toggle é sobre lembrete de dívida,
// não sobre desligar o WhatsApp inteiro (isso já existe, é
// `clientes.opt_out_whatsapp`, mais amplo).
export const TIPOS_COBRANCA_WHATSAPP = ['extrato', 'atualizacao_conta', 'cobranca', 'lembrete_vencimento'] as const

export function ehTipoCobranca(tipo: string | null | undefined): boolean {
  return !!tipo && (TIPOS_COBRANCA_WHATSAPP as readonly string[]).includes(tipo)
}
