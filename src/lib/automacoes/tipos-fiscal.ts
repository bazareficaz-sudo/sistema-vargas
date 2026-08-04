import { emitirNfceParaVenda } from '@/lib/fiscal/emitirParaVenda'
import type { ResultadoExecucao } from './tipos'

// Vendas elegíveis pra emissão automática: só venda "pura" concluída, ainda
// não emitida. Cada regra fiscal poll a própria janela [cursor, agora) e
// filtra pela condição do tipo — se duas regras diferentes acertarem a
// mesma venda, emitirNfceParaVenda já é idempotente (checa nfce_status
// antes de tentar de novo).
async function vendasElegiveisDesde(sb: any, empresaId: string, desde: string) {
  const { data, error } = await sb.from('vendas').select('id, cliente_id, forma_pagamento, created_at')
    .eq('empresa_id', empresaId).eq('status', 'concluida').eq('tipo_operacao', 'venda')
    // ATENÇÃO: aqui estava `.neq('nfce_status', 'autorizada')`, e isso fazia a
    // emissão automática NUNCA disparar.
    //
    // Em SQL, `NULL != 'autorizada'` não é verdadeiro — é NULO — então a linha
    // é descartada. E venda recém-feita tem nfce_status NULO, porque ninguém
    // tentou emitir ainda. Ou seja: o filtro que deveria dizer "ainda não foi
    // autorizada" excluía exatamente as vendas novas, que são as únicas que
    // interessam. Só sobrariam vendas com tentativa anterior falha.
    //
    // Medido em produção: a consulta antiga devolvia 0 vendas; esta devolve as
    // 90 do dia (23 delas em pix).
    .or('nfce_status.is.null,nfce_status.neq.autorizada')
    .gt('created_at', desde)

  // Erro de consulta virando lista vazia é indistinguível de "não há venda":
  // a regra gravaria 'sem_acao' e ninguém saberia. Propaga para o executor
  // registrar como erro.
  if (error) throw new Error(`Consulta de vendas elegíveis: ${error.message}`)
  return data ?? []
}

async function emitirParaVendas(sb: any, empresaId: string, vendaIds: string[]): Promise<ResultadoExecucao> {
  let falhas = 0
  for (const id of vendaIds) {
    const r = await emitirNfceParaVenda(sb, empresaId, id, 'automacao')
    if (!r.ok && !r.jaEmitida) falhas++
  }
  return {
    status: vendaIds.length === 0 ? 'sem_acao' : (falhas === vendaIds.length ? 'erro' : 'ok'),
    erro: falhas > 0 ? `${falhas}/${vendaIds.length} emissão(ões) falharam` : undefined,
    avancarCursorPara: new Date().toISOString(),
  }
}

export async function executarEmissaoPorProduto(sb: any, a: any): Promise<ResultadoExecucao> {
  const produtoIds = (a.produtos ?? []).map((p: any) => p.produto_id)
  if (produtoIds.length === 0) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const desde = a.cursor_processado ?? a.created_at
  const vendas = await vendasElegiveisDesde(sb, a.empresa_id, desde)
  if (vendas.length === 0) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const vendaIds = vendas.map((v: any) => v.id)
  const { data: itens } = await sb.from('venda_itens').select('venda_id').in('venda_id', vendaIds).in('produto_id', produtoIds)
  const idsComProduto = [...new Set<string>((itens ?? []).map((i: any) => i.venda_id))]
  return emitirParaVendas(sb, a.empresa_id, idsComProduto)
}

export async function executarEmissaoPorFormaPagamento(sb: any, a: any): Promise<ResultadoExecucao> {
  if (!a.forma_pagamento) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const desde = a.cursor_processado ?? a.created_at
  const vendas = await vendasElegiveisDesde(sb, a.empresa_id, desde)
  const idsComForma = vendas.filter((v: any) => v.forma_pagamento === a.forma_pagamento).map((v: any) => v.id)
  return emitirParaVendas(sb, a.empresa_id, idsComForma)
}

export async function executarEmissaoPorCliente(sb: any, a: any): Promise<ResultadoExecucao> {
  if (!a.cliente_id) return { status: 'sem_acao', avancarCursorPara: new Date().toISOString() }

  const desde = a.cursor_processado ?? a.created_at
  const vendas = await vendasElegiveisDesde(sb, a.empresa_id, desde)
  const idsDoCliente = vendas.filter((v: any) => v.cliente_id === a.cliente_id).map((v: any) => v.id)
  return emitirParaVendas(sb, a.empresa_id, idsDoCliente)
}
