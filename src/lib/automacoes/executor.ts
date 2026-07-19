import { TIPOS_AGENDADOS_1X_DIA, horarioJaPassou, hojeISO, type ResultadoExecucao } from './tipos'
import {
  executarRelatorioDiario, executarPedidoCliente, executarAlertaProduto,
  executarAlertaPedidoMarketplace, executarEstoqueBaixo, executarContaReceber, executarContaPagar,
} from './tipos-whatsapp'
import { executarMargemBaixa, executarProdutoParado, executarInadimplencia, executarMetaVendas } from './tipos-alertas'

const HANDLERS: Record<string, (sb: any, a: any) => Promise<ResultadoExecucao>> = {
  whatsapp_relatorio_diario: executarRelatorioDiario,
  whatsapp_pedido_cliente: executarPedidoCliente,
  whatsapp_alerta_produto: executarAlertaProduto,
  whatsapp_alerta_pedido_marketplace: executarAlertaPedidoMarketplace,
  whatsapp_estoque_baixo: executarEstoqueBaixo,
  whatsapp_conta_receber: executarContaReceber,
  whatsapp_conta_pagar: executarContaPagar,
  alerta_margem_baixa: executarMargemBaixa,
  alerta_produto_parado: executarProdutoParado,
  alerta_inadimplencia: executarInadimplencia,
  alerta_meta_vendas: executarMetaVendas,
}

function elegivelAgora(a: any): boolean {
  if (TIPOS_AGENDADOS_1X_DIA.has(a.tipo)) {
    if (a.ultima_execucao_dia === hojeISO()) return false
    return horarioJaPassou(a.horario_envio)
  }
  return true // tipos por evento: sempre elegíveis, o handler decide se há algo novo
}

export async function executarAutomacoesPendentes(sb: any): Promise<{ processadas: number; sucesso: number; erro: number; semAcao: number }> {
  const tipos = Object.keys(HANDLERS)
  const { data: automacoes } = await sb.from('automacoes').select('*').eq('ativa', true).in('tipo', tipos)

  let sucesso = 0, erro = 0, semAcao = 0, processadas = 0

  for (const a of automacoes ?? []) {
    if (!elegivelAgora(a)) continue
    processadas++

    const handler = HANDLERS[a.tipo]
    let resultado: ResultadoExecucao
    try {
      resultado = await handler(sb, a)
    } catch (e: any) {
      resultado = { status: 'erro', erro: e?.message ?? 'Erro desconhecido' }
    }

    if (resultado.status === 'ok') sucesso++
    else if (resultado.status === 'erro') erro++
    else semAcao++

    const update: Record<string, any> = {
      ultima_execucao: new Date().toISOString(),
      total_execucoes: (a.total_execucoes ?? 0) + (resultado.status === 'sem_acao' ? 0 : 1),
      ultimo_status: resultado.status,
      ultimo_erro: resultado.status === 'erro' ? (resultado.erro ?? 'Erro desconhecido') : null,
    }
    if (TIPOS_AGENDADOS_1X_DIA.has(a.tipo)) update.ultima_execucao_dia = hojeISO()
    if (resultado.avancarCursorPara) update.cursor_processado = resultado.avancarCursorPara

    await sb.from('automacoes').update(update).eq('id', a.id)
  }

  return { processadas, sucesso, erro, semAcao }
}
