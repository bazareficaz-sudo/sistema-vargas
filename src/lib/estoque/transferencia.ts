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

/**
 * Lê de uma vez tudo que o laço precisa: produtos dos dois lados e saldos
 * dos dois depósitos. Antes cada item fazia essas 4 consultas por conta
 * própria — numa transferência de 36 produtos eram ~150 idas ao banco só
 * de leitura, em fila, e a rota estourava o tempo antes de gravar nada.
 *
 * `.in()` vai pela URL, então lê em blocos pra não estourar o tamanho.
 */
async function carregarContexto(sb: any, p: ParametrosTransferencia, produtoDestinoIds: string[]) {
  const BLOCO = 100
  const produtoOrigemIds = p.itens.map(i => i.produtoId)

  async function lerEmBlocos(tabela: string, colunas: string, coluna: string, ids: string[], filtros: (q: any) => any) {
    const out: any[] = []
    for (let i = 0; i < ids.length; i += BLOCO) {
      const q = filtros(sb.from(tabela).select(colunas).in(coluna, ids.slice(i, i + BLOCO)))
      const { data } = await q
      out.push(...(data ?? []))
    }
    return out
  }

  const [origens, destinos, saldosOrigem, saldosDestino] = await Promise.all([
    lerEmBlocos('produtos', 'id, nome, estoque', 'id', produtoOrigemIds, (q: any) => q.eq('empresa_id', p.empresaOrigemId)),
    lerEmBlocos('produtos', 'id, nome, estoque', 'id', produtoDestinoIds, (q: any) => q.eq('empresa_id', p.empresaDestinoId)),
    lerEmBlocos('produto_estoque', 'id, produto_id, quantidade', 'produto_id', produtoOrigemIds, (q: any) => q.eq('deposito_id', p.depositoOrigemId)),
    lerEmBlocos('produto_estoque', 'id, produto_id, quantidade', 'produto_id', produtoDestinoIds, (q: any) => q.eq('deposito_id', p.depositoDestinoId)),
  ])

  return {
    origemPorId: new Map<string, any>(origens.map(x => [x.id, x])),
    destinoPorId: new Map<string, any>(destinos.map(x => [x.id, x])),
    saldoOrigemPorProduto: new Map<string, { id: string; quantidade: number }>(
      saldosOrigem.map(x => [x.produto_id, { id: x.id, quantidade: Number(x.quantidade ?? 0) }])),
    saldoDestinoPorProduto: new Map<string, { id: string; quantidade: number }>(
      saldosDestino.map(x => [x.produto_id, { id: x.id, quantidade: Number(x.quantidade ?? 0) }])),
  }
}

// `linhaId` vem pré-carregado por carregarContexto — quando existe, pula a
// consulta de "já tem linha?", que antes acontecia duas vezes por item.
async function gravarSaldoNoDeposito(
  sb: any, empresaId: string, depositoId: string, produtoId: string, novoSaldo: number, linhaId?: string,
): Promise<void> {
  const id = linhaId ?? (await sb.from('produto_estoque')
    .select('id').eq('deposito_id', depositoId).eq('produto_id', produtoId).maybeSingle()).data?.id

  if (id) {
    await sb.from('produto_estoque')
      .update({ quantidade: novoSaldo, ultima_movimentacao: new Date().toISOString() })
      .eq('id', id)
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

  const produtoDestinoIds = p.itens
    .map(i => mesmaEmpresa ? i.produtoId : p.produtoDestinoPorOrigem?.[i.produtoId])
    .filter((x): x is string => !!x)
  const ctx = await carregarContexto(sb, p, produtoDestinoIds)

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

    const origem = ctx.origemPorId.get(item.produtoId)
    if (!origem) {
      resultados.push({ produtoId: item.produtoId, produtoNome: item.produtoId, ok: false, erro: 'Produto não encontrado na empresa de origem.' })
      continue
    }

    const destinoProduto = ctx.destinoPorId.get(produtoDestinoId)
    if (!destinoProduto) {
      resultados.push({ produtoId: item.produtoId, produtoNome: origem.nome, ok: false, erro: 'Produto de destino não encontrado.' })
      continue
    }

    // O saldo por depósito é o que valida e limita a transferência — não
    // `produtos.estoque` (que é o total da empresa inteira, somando todos
    // os depósitos). Transferir "o que tem nesta prateleira" só faz
    // sentido medido nesta prateleira.
    const saldoOrigem = ctx.saldoOrigemPorProduto.get(item.produtoId)?.quantidade ?? 0
    if (item.quantidade > saldoOrigem) {
      resultados.push({
        produtoId: item.produtoId, produtoNome: origem.nome, ok: false,
        erro: `Estoque insuficiente neste depósito (disponível: ${saldoOrigem}).`,
      })
      continue
    }

    const saldoDestinoAtual = ctx.saldoDestinoPorProduto.get(produtoDestinoId)?.quantidade ?? 0

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

    // As quatro escritas de saldo são independentes entre si (linhas
    // diferentes, produtos diferentes) — esperar uma pela outra só somava
    // latência. A ORDEM que importa (documento antes do saldo) continua
    // garantida: o insert acima já foi confirmado antes de chegar aqui.
    const linhaOrigem = ctx.saldoOrigemPorProduto.get(item.produtoId)
    const linhaDestino = ctx.saldoDestinoPorProduto.get(produtoDestinoId)
    const novoSaldoOrigem = saldoOrigem - item.quantidade
    const novoSaldoDestino = saldoDestinoAtual + item.quantidade

    await Promise.all([
      // Origem: sai do depósito. Fora da mesma empresa, sai também do total.
      gravarSaldoNoDeposito(sb, p.empresaOrigemId, p.depositoOrigemId, item.produtoId, novoSaldoOrigem, linhaOrigem?.id),
      // Destino: entra no depósito. Fora da mesma empresa, entra no total.
      gravarSaldoNoDeposito(sb, p.empresaDestinoId, p.depositoDestinoId, produtoDestinoId, novoSaldoDestino, linhaDestino?.id),
      ...(mesmaEmpresa ? [] : [
        sb.from('produtos').update({ estoque: Number(origem.estoque ?? 0) - item.quantidade }).eq('id', item.produtoId),
        sb.from('produtos').update({ estoque: Number(destinoProduto.estoque ?? 0) + item.quantidade }).eq('id', produtoDestinoId),
      ]),
      registrarMovimentoEstoque(sb, {
        empresaId: p.empresaOrigemId, depositoId: p.depositoOrigemId,
        produtoId: item.produtoId, produtoNome: origem.nome,
        tipo: 'transferencia_saida', quantidade: item.quantidade,
        estoqueAnterior: saldoOrigem, estoqueNovo: novoSaldoOrigem,
        referenciaTipo: 'transferencia', referenciaId: transf.id,
        usuario: p.usuario, observacao: p.observacao,
        motivo: mesmaEmpresa ? 'Transferência entre depósitos' : 'Transferência para outra empresa do grupo',
      }),
      registrarMovimentoEstoque(sb, {
        empresaId: p.empresaDestinoId, depositoId: p.depositoDestinoId,
        produtoId: produtoDestinoId, produtoNome: destinoProduto.nome,
        tipo: 'transferencia_entrada', quantidade: item.quantidade,
        estoqueAnterior: saldoDestinoAtual, estoqueNovo: novoSaldoDestino,
        referenciaTipo: 'transferencia', referenciaId: transf.id,
        usuario: p.usuario, observacao: p.observacao,
        motivo: mesmaEmpresa ? 'Transferência entre depósitos' : 'Transferência recebida de outra empresa do grupo',
      }),
    ])

    // Mantém o contexto coerente caso o mesmo produto apareça duas vezes.
    ctx.saldoOrigemPorProduto.set(item.produtoId, { id: linhaOrigem?.id ?? '', quantidade: novoSaldoOrigem })
    ctx.saldoDestinoPorProduto.set(produtoDestinoId, { id: linhaDestino?.id ?? '', quantidade: novoSaldoDestino })

    resultados.push({ produtoId: item.produtoId, produtoNome: origem.nome, ok: true, quantidadeTransferida: item.quantidade })
  }

  return {
    resultados,
    transferidos: resultados.filter(r => r.ok).length,
    falhas: resultados.filter(r => !r.ok).length,
  }
}
