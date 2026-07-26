import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'

export type MovimentoMonitorado = {
  produtoId: string
  produtoNome: string
  tipo: 'venda' | 'devolucao'
  quantidade: number
  estoqueAnterior: number
  estoqueNovo: number
  quem?: string | null
  origem: string
}

// Alerta de WhatsApp pro gestor da empresa quando um produto marcado como
// "Monitorar produto" tem movimentação — usa o mesmo pipeline de envio das
// automações (fila em whatsapp_mensagens + Z-API), só que disparado na hora
// do evento em vez de rodar por um cron periódico.
export async function notificarMovimentoProduto(sb: any, empresaId: string, m: MovimentoMonitorado): Promise<void> {
  const { data: config } = await sb.from('whatsapp_config').select('numero_gestor').eq('empresa_id', empresaId).maybeSingle()
  if (!config?.numero_gestor) return

  const acao = m.tipo === 'devolucao' ? 'Devolução' : 'Venda'
  const mensagem = [
    `📦 *${m.produtoNome}* — produto monitorado`,
    `${acao} de ${Math.abs(m.quantidade)} un. — ${m.origem}`,
    m.quem ? `Cliente: ${m.quem}` : null,
    `Saldo em estoque: ${m.estoqueNovo}`,
  ].filter(Boolean).join('\n')

  await enviarWhatsappAutomacao(sb, empresaId, config.numero_gestor, mensagem, {
    tipo: 'monitoramento_produto',
    referencia_tipo: 'produto',
    referencia_id: m.produtoId,
  })
}
