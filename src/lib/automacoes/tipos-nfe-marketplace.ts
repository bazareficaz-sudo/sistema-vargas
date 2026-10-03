import { emitirNfeDoPedido } from '@/lib/fiscal/emitirNfePedido'
import { notaResolvida } from '@/lib/pedidos/esteira'
import { LIMITE_NFE_MARKETPLACE_POR_RODADA, type ResultadoExecucao } from './tipos'

// EMISSÃO AUTOMÁTICA DE NF-e PARA PEDIDOS DE MARKETPLACE
//
// Regra do tipo `emissao_fiscal_marketplace`: "emitir a NF-e dos pedidos do
// canal X (ou de todos os canais do marketplace Y), no ritmo Z" — imediato, de
// hora em hora ou em horários marcados (ex.: 10:00 e 14:00, antes de cada
// coleta). O objetivo é logístico: o pedido chega na etapa de etiqueta com a
// nota pronta, sem ninguém clicar pedido por pedido.
//
// A nota é a MESMA da tela do pedido (emitirNfeDoPedido): emitente do canal,
// CFOP/CST do perfil fiscal, conferência antes de enviar. A automação só
// escolhe quais pedidos e quando.
//
// Quais pedidos:
//   · pagos e ainda não enviados (status `confirmado`);
//   · todos os itens vinculados a produto;
//   · sem nota: nem emitida aqui, nem informada à mão, nem já aceita pelo
//     canal (a nota emitida em outro sistema aparece assim — `notaResolvida`,
//     a mesma régua da esteira);
//   · bloqueados numa rodada anterior só voltam depois de BLOQUEIO_ESPERA —
//     dá tempo de corrigir o cadastro sem a regra martelar o mesmo pedido.
//
// Pedido com nota REJEITADA pela SEFAZ não é tentado de novo sozinho: a
// rejeição quase sempre pede uma correção, e repetir só gera outra rejeição.
// Fica para o botão do pedido, onde o motivo aparece.

const BLOQUEIO_ESPERA_MS = 3 * 60 * 60 * 1000
// O cron tem 300 s para TODAS as regras de todas as empresas; esta não pode
// gastar tudo sozinha. O que sobrar fica para a próxima rodada.
const ORCAMENTO_MS = 150_000

const STATUS_FINAIS_ITEM = new Set(['com_pendencia', 'pendencia_mapeamento', 'cancelado', 'concluido', 'enviado'])

/** O pedido está na vez de ganhar nota automática? Puro — testado à parte. */
export function pedidoAptoParaNfeAutomatica(p: any, agora = Date.now()): boolean {
  if (p.status !== 'confirmado') return false
  if (p.nfe_numero || p.nfe_informada_em) return false
  if (p.nfe_status === 'bloqueada') {
    const em = Date.parse(p.nfe_emissao_em ?? '')
    if (!Number.isFinite(em) || agora - em < BLOQUEIO_ESPERA_MS) return false
  } else if (p.nfe_status != null) {
    return false
  }
  if (STATUS_FINAIS_ITEM.has(p.etapa_interna)) return false
  const itens: any[] = p.marketplace_pedido_itens ?? []
  if (itens.length === 0 || itens.some(i => !i.produto_id)) return false
  return !notaResolvida(p)
}

const COLUNAS = [
  'id, canal_id, status, status_externo, etapa_interna, envio_status, envio_substatus',
  'nfe_status, nfe_numero, nfe_informada_em, data_pedido',
  'nfe_emissao_em:nfe_emissao->>em',
  'need_upload_invoice:dados_brutos->>need_upload_invoice',
  'marketplace_canais(plataforma)',
  'marketplace_pedido_itens(produto_id)',
].join(', ')

export async function executarEmissaoNfeMarketplace(sb: any, a: any): Promise<ResultadoExecucao> {
  const agora = new Date().toISOString()

  // Canal específico, ou todos os canais ativos de um marketplace.
  let qCanais = sb.from('marketplace_canais').select('id').eq('empresa_id', a.empresa_id)
  if (a.marketplace_canal_id) qCanais = qCanais.eq('id', a.marketplace_canal_id)
  else if (a.canal_venda) qCanais = qCanais.eq('plataforma', a.canal_venda).eq('ativo', true)
  else return { status: 'erro', erro: 'Regra sem canal nem marketplace escolhido.' }
  const { data: canais, error: erroCanais } = await qCanais
  if (erroCanais) throw new Error(`Canais: ${erroCanais.message}`)
  const canalIds = (canais ?? []).map((c: any) => c.id)
  if (canalIds.length === 0) return { status: 'sem_acao', avancarCursorPara: agora }

  const { data: pedidos, error } = await sb.from('marketplace_pedidos').select(COLUNAS)
    .eq('empresa_id', a.empresa_id)
    .in('canal_id', canalIds)
    .eq('status', 'confirmado')
    .or('nfe_status.is.null,nfe_status.eq.bloqueada')
    .is('nfe_numero', null)
    .is('nfe_informada_em', null)
    .order('data_pedido', { ascending: true })
    .limit(300)
  // Erro de consulta não pode virar "nada a fazer" silencioso.
  if (error) throw new Error(`Pedidos elegíveis: ${error.message}`)

  const aptos = (pedidos ?? []).filter((p: any) => pedidoAptoParaNfeAutomatica(p)).slice(0, LIMITE_NFE_MARKETPLACE_POR_RODADA)
  if (aptos.length === 0) return { status: 'sem_acao', avancarCursorPara: agora }

  const inicio = Date.now()
  let autorizadas = 0, rejeitadas = 0, bloqueadas = 0
  const motivos: string[] = []
  for (const p of aptos) {
    if (Date.now() - inicio > ORCAMENTO_MS) break
    const r = await emitirNfeDoPedido(sb, a.empresa_id, p.id, `automação: ${a.nome}`, {
      registrarBloqueio: { statusAtual: p.nfe_status ?? null },
    })
    if (r.ok || r.jaEmitida) autorizadas++
    else if (r.bloqueada) { bloqueadas++; motivos.push(r.erro ?? r.erros?.[0] ?? 'bloqueada') }
    else { rejeitadas++; motivos.push(r.motivoRejeicao ?? r.erro ?? 'rejeitada') }
  }

  const falhas = rejeitadas + bloqueadas
  if (falhas === 0) return { status: 'ok', avancarCursorPara: agora }
  const resumo = `${autorizadas} emitida(s), ${rejeitadas} rejeitada(s), ${bloqueadas} bloqueada(s). ` +
    `Primeiro motivo: ${motivos[0]}`
  // Qualquer falha vira 'erro' — é o que dispara o aviso por WhatsApp da
  // regra. Pedido parado sem nota atrasa o despacho; melhor avisar.
  return { status: 'erro', erro: resumo, avancarCursorPara: agora }
}
