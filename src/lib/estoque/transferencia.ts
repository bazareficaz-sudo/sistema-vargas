import { registrarMovimentoEstoque } from '@/lib/produtos/movimentacao'

// Motor de transferência de estoque — entre depósitos da mesma empresa, ou
// entre empresas do mesmo grupo.
//
// A diferença entre os dois casos não é só "escreve em mais uma tabela":
// dentro da MESMA empresa, o total (`produtos.estoque`) não muda — só a
// distribuição entre depósitos (`produto_estoque`) é redistribuída. Entre
// empresas DIFERENTES, o produto de origem e o produto de destino são
// linhas cadastrais distintas (cada empresa tem seu próprio catálogo), e o
// total muda dos dois lados: cai na origem, sobe no destino. Por isso este
// motor recebe sempre um `produtoDestinoId` já resolvido — ele não decide
// vínculo entre produtos de empresas diferentes, isso é responsabilidade de
// quem chama (a rota da API, via `produto_vinculos`), e nunca inventa um
// produto do outro lado.
//
// NÃO É TRANSACIONAL — mesmo padrão já usado em toda entrada de mercadoria
// deste sistema (NovaEntradaClient, EntradaXmlDetalheClient): vários
// `update`/`insert` em sequência, sem rollback automático se um passo do
// meio falhar. A ordem foi escolhida para que a pior falha possível seja a
// mais barata de perceber e corrigir: o registro de transferência é gravado
// ANTES de mexer em estoque, então mesmo numa falha no meio do caminho fica
// rastro de que algo foi tentado — o extrato por depósito (Movimentações)
// é o lugar de conferir se bateu.

export type ItemTransferencia = {
  produtoId: string
  quantidade: number
  /** Só para rastro — o motor não recalcula a partir disto. */
  percentual?: number | null
}

export type ResultadoItemTransferencia = {
  produtoId: string
  produtoNome: string
  ok: boolean
  erro?: string
  quantidadeTransferida?: number
}

export type ParametrosTransferencia = {
  empresaOrigemId: string
  depositoOrigemId: string
  empresaDestinoId: string
  depositoDestinoId: string
  itens: ItemTransferencia[]
  usuario: string | null
  observacao?: string | null
  entradaId?: string | null
  entradaOrigem?: 'manual' | 'xml' | null
  /**
   * produtoId de origem → produtoId de destino. Obrigatório preencher toda
   * chave quando as empresas são diferentes; ignorado quando é a mesma
   * empresa (o produto de destino é o mesmo). Resolvido fora deste motor.
   */
  produtoDestinoPorOrigem?: Record<string, string>
}

async function saldoNoDeposito(sb: any, depositoId: string, produtoId: string): Promise<number> {
  const { data } = await sb.from('produto_estoque')
    .select('quantidade').eq('deposito_id', depositoId).eq('produto_id', produtoId).maybeSingle()
  return Number(data?.quantidade ?? 0)
}

async function gravarSaldoNoDeposito(sb: any, empresaId: string, depositoId: string, produtoId: string, novoSaldo: number): Promise<void> {
  const { data: existente } = await sb.from('produto_estoque')
    .select('id').eq('deposito_id', depositoId).eq('produto_id', produtoId).maybeSingle()
  if (existente) {
    await sb.from('produto_estoque')
      .update({ quantidade: novoSaldo, ultima_movimentacao: new Date().toISOString() })
      .eq('id', existente.id)
  } else {
    await sb.from('produto_estoque')
      .insert({ empresa_id: empresaId, deposito_id: depositoId, produto_id: produtoId, quantidade: novoSaldo })
  }
}

export async function executarTransferencia(sb: any, p: ParametrosTransferencia): Promise<{
  resultados: ResultadoItemTransferencia[]
  transferidos: number
  falhas: number
}> {
  const mesmaEmpresa = p.empresaOrigemId === p.empresaDestinoId
  const resultados: ResultadoItemTransferencia[] = []

  for (const item of p.itens) {
    const produtoDestinoId = mesmaEmpresa ? item.produtoId : p.produtoDestinoPorOrigem?.[item.produtoId]

    if (!produtoDestinoId) {
      resultados.push({ produtoId: item.produtoId, produtoNome: item.produtoId, ok: false, erro: 'Sem produto vinculado na empresa destino.' })
      continue
    }
    if (!(item.quantidade > 0)) {
      resultados.push({ produtoId: item.produtoId, produtoNome: item.produtoId, ok: false, erro: 'Quantidade inválida.' })
      continue
    }

    const { data: origem } = await sb.from('produtos')
      .select('id, nome, estoque').eq('id', item.produtoId).eq('empresa_id', p.empresaOrigemId).maybeSingle()
    if (!origem) {
      resultados.push({ produtoId: item.produtoId, produtoNome: item.produtoId, ok: false, erro: 'Produto não encontrado na empresa de origem.' })
      continue
    }

    const { data: destinoProduto } = await sb.from('produtos')
      .select('id, nome, estoque').eq('id', produtoDestinoId).eq('empresa_id', p.empresaDestinoId).maybeSingle()
    if (!destinoProduto) {
      resultados.push({ produtoId: item.produtoId, produtoNome: origem.nome, ok: false, erro: 'Produto de destino não encontrado.' })
      continue
    }

    // O saldo por depósito é o que valida e limita a transferência — não
    // `produtos.estoque` (que é o total da empresa inteira, somando todos
    // os depósitos). Transferir "o que tem nesta prateleira" só faz
    // sentido medido nesta prateleira.
    const saldoOrigem = await saldoNoDeposito(sb, p.depositoOrigemId, item.produtoId)
    if (item.quantidade > saldoOrigem) {
      resultados.push({
        produtoId: item.produtoId, produtoNome: origem.nome, ok: false,
        erro: `Estoque insuficiente neste depósito (disponível: ${saldoOrigem}).`,
      })
      continue
    }

    const saldoDestinoAtual = await saldoNoDeposito(sb, p.depositoDestinoId, produtoDestinoId)

    // Grava o documento da transferência ANTES de mexer em estoque —
    // ver nota no topo do arquivo sobre por que a ordem é essa.
    const { data: transf, error: erroTransf } = await sb.from('transferencias_estoque').insert({
      empresa_id: p.empresaOrigemId,
      empresa_destino_id: p.empresaDestinoId,
      deposito_origem: p.depositoOrigemId,
      deposito_destino: p.depositoDestinoId,
      produto_id: item.produtoId,
      produto_destino_id: produtoDestinoId,
      produto_nome: origem.nome,
      quantidade: item.quantidade,
      percentual: item.percentual ?? null,
      entrada_id: p.entradaId ?? null,
      entrada_origem: p.entradaOrigem ?? null,
      observacao: p.observacao ?? null,
      usuario: p.usuario ?? null,
    }).select('id').single()

    if (erroTransf || !transf) {
      resultados.push({ produtoId: item.produtoId, produtoNome: origem.nome, ok: false, erro: erroTransf?.message ?? 'Falha ao registrar a transferência.' })
      continue
    }

    // Origem: sai do depósito. Fora da mesma empresa, sai também do total.
    await gravarSaldoNoDeposito(sb, p.empresaOrigemId, p.depositoOrigemId, item.produtoId, saldoOrigem - item.quantidade)
    if (!mesmaEmpresa) {
      await sb.from('produtos').update({ estoque: Number(origem.estoque ?? 0) - item.quantidade }).eq('id', item.produtoId)
    }

    // Destino: entra no depósito. Fora da mesma empresa, entra também no total.
    await gravarSaldoNoDeposito(sb, p.empresaDestinoId, p.depositoDestinoId, produtoDestinoId, saldoDestinoAtual + item.quantidade)
    if (!mesmaEmpresa) {
      await sb.from('produtos').update({ estoque: Number(destinoProduto.estoque ?? 0) + item.quantidade }).eq('id', produtoDestinoId)
    }

    await registrarMovimentoEstoque(sb, {
      empresaId: p.empresaOrigemId, depositoId: p.depositoOrigemId,
      produtoId: item.produtoId, produtoNome: origem.nome,
      tipo: 'transferencia_saida', quantidade: item.quantidade,
      estoqueAnterior: saldoOrigem, estoqueNovo: saldoOrigem - item.quantidade,
      referenciaTipo: 'transferencia', referenciaId: transf.id,
      usuario: p.usuario, observacao: p.observacao,
      motivo: mesmaEmpresa ? 'Transferência entre depósitos' : 'Transferência para outra empresa do grupo',
    })
    await registrarMovimentoEstoque(sb, {
      empresaId: p.empresaDestinoId, depositoId: p.depositoDestinoId,
      produtoId: produtoDestinoId, produtoNome: destinoProduto.nome,
      tipo: 'transferencia_entrada', quantidade: item.quantidade,
      estoqueAnterior: saldoDestinoAtual, estoqueNovo: saldoDestinoAtual + item.quantidade,
      referenciaTipo: 'transferencia', referenciaId: transf.id,
      usuario: p.usuario, observacao: p.observacao,
      motivo: mesmaEmpresa ? 'Transferência entre depósitos' : 'Transferência recebida de outra empresa do grupo',
    })

    resultados.push({ produtoId: item.produtoId, produtoNome: origem.nome, ok: true, quantidadeTransferida: item.quantidade })
  }

  return {
    resultados,
    transferidos: resultados.filter(r => r.ok).length,
    falhas: resultados.filter(r => !r.ok).length,
  }
}
