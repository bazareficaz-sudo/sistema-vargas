// AGENTE GETÚLIO — o sistema olhando o negócio no lugar do dono.
//
// Três camadas, e a separação é de propósito:
//   VIGIAS (vigias.ts)   detectam. Consultas e contas exatas, sem IA — número
//                        que vai para o dono não pode ser chute.
//   SINAIS (varredura)   o que foi achado, com memória: achado de novo só
//                        atualiza, sumiu é resolvido. É o que impede o mesmo
//                        aviso de chegar todo dia.
//   VOZ (resumo.ts)      a IA escolhe, ordena e escreve; o WhatsApp entrega.
//                        Sem IA disponível, um modelo fixo escreve no lugar.

export type Gravidade = 'urgente' | 'atencao' | 'oportunidade' | 'info'

export type Sinal = {
  vigia: VigiaId
  /** Identidade do FATO (ex.: "anuncio:bloqueado:<id>"). Estável entre varreduras. */
  chave: string
  gravidade: Gravidade
  titulo: string
  detalhe: string
  /** Dinheiro em jogo, em R$, quando dá para medir. Ordena o que é mais importante. */
  valor: number | null
  /** Caminho no sistema onde se resolve ("/dashboard/..."). */
  link: string | null
  dados?: Record<string, unknown>
}

export const VIGIAS = [
  { id: 'integracoes', nome: 'Integrações com problema', ajuda: 'Canal recusando atualizações (app suspenso, conta desconectada) ou sem sincronizar há mais de um dia.' },
  { id: 'anuncios_bloqueados', nome: 'Anúncios reprovados ou travados', ajuda: 'Reprovados, congelados ou em revisão no canal — só os que têm produto com estoque, porque é venda perdida.' },
  { id: 'zerado_a_venda', nome: 'Zerado ainda à venda', ajuda: 'Produto com estoque zero no sistema e anúncio ativo com estoque no canal: risco de vender o que não tem.' },
  { id: 'pedidos_atrasados', nome: 'Pedidos atrasados', ajuda: 'Pedido de marketplace com prazo de postagem vencido e ainda não enviado.' },
  { id: 'vendas_canal', nome: 'Vendas fora do normal', ajuda: 'Canal que vendeu bem menos (ou bem mais) nesta semana do que a média das 4 anteriores.' },
  { id: 'vai_faltar', nome: 'Vai faltar estoque', ajuda: 'Produto que vende e tem estoque para menos de uma semana — ou que disparou e acaba em menos de duas.' },
  { id: 'estoque_parado', nome: 'Dinheiro parado em estoque', ajuda: 'Valor a custo de produtos sem venda há mais de 60 dias.' },
  { id: 'estoque_negativo', nome: 'Estoque negativo', ajuda: 'Produto com estoque abaixo de zero — venda sem entrada lançada ou contagem errada.' },
  { id: 'financeiro', nome: 'Contas a pagar e a receber', ajuda: 'Contas vencidas e o que vence nos próximos 7 dias; clientes em atraso.' },
] as const

export type VigiaId = typeof VIGIAS[number]['id']

export const ORDEM_GRAVIDADE: Record<Gravidade, number> = { urgente: 0, atencao: 1, oportunidade: 2, info: 3 }

/**
 * Dentro da mesma gravidade, o que vem primeiro. Canal recusando tudo e
 * produto zerado à venda afetam muitas vendas de uma vez — vêm antes de uma
 * conta vencida, que vem antes de repor estoque.
 */
export const PRIORIDADE_VIGIA: Record<string, number> = {
  integracoes: 0, zerado_a_venda: 1, pedidos_atrasados: 2, financeiro: 3, vai_faltar: 4,
  vendas_canal: 5, anuncios_bloqueados: 6, estoque_parado: 7, estoque_negativo: 8,
}

export type Destinatario = { nome: string; numero: string }

export type ConfigGetulio = {
  empresa_id: string
  ativo: boolean
  horario_resumo: string
  destinatarios: Destinatario[]
  vigias_desligados: string[]
  /** Conversa pelo WhatsApp: responder perguntas dos destinatários. */
  responder_whatsapp: boolean
  /** Urgente que acabou de aparecer vai na hora, sem esperar o resumo. */
  alertas_imediatos?: boolean
  /** Na segunda, o resumo abre com a semana que passou. */
  resumo_semanal?: boolean
  ultima_varredura: string | null
  ultimo_resumo_dia: string | null
}
