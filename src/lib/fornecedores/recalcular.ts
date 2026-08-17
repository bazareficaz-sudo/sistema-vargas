// Materializa o histórico de compra por fornecedor×produto.
//
// O cálculo em si já existia — /api/pedidos-compra/historico-fornecedor lê
// entrada manual + XML e monta último custo, custo médio, última compra.
// Esta função faz a MESMA leitura, mas agregada pelos dois lados (produto E
// fornecedor) numa passada só, e grava em `fornecedor_produto` em vez de
// recalcular a cada abertura de tela — é o que permite ao Auxiliar de
// Compras mostrar "este produto tem 3 fornecedores" sem reler entradas toda
// vez que uma linha da lista é expandida.
//
// SÓ MEXE NOS CAMPOS CALCULADOS. `prazo_entrega_dias`, `quantidade_minima`,
// `multiplo_embalagem` e `preferencial` são editados pelo comprador — a
// rodada nunca escreve neles. Um upsert que sobrescrevesse a linha inteira
// apagaria essas escolhas toda noite.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function paginar<T = Record<string, unknown>>(
  sb: any, tabela: string, select: string, filtros: (q: any) => any, pagina = 1000,
): Promise<T[]> {
  const tudo: T[] = []
  for (let inicio = 0; ; inicio += pagina) {
    const { data, error } = await filtros(sb.from(tabela).select(select)).range(inicio, inicio + pagina - 1)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    if (!data?.length) break
    tudo.push(...data)
    if (data.length < pagina) break
  }
  return tudo
}

type Agregado = {
  custos: number[]
  ultimoCusto: number
  ultimaCompra: string
  ultimaQtd: number
  contadas: number
}

export type ResumoFornecedores = {
  empresaId: string
  linhas: number
  comPrazoReal: number
  duracaoMs: number
}

export async function recalcularFornecedorProduto(sb: any, empresaId: string): Promise<ResumoFornecedores> {
  const t0 = Date.now()

  // ── Entradas manuais, confirmadas ────────────────────────────
  const entradas = await paginar<any>(sb, 'entradas',
    'id, fornecedor_id, data_entrada, pedido_compra_id',
    q => q.eq('empresa_id', empresaId).eq('status', 'confirmada').not('fornecedor_id', 'is', null))
  const fornecedorPorEntrada = new Map(entradas.map((e: any) => [e.id, e.fornecedor_id]))
  const dataPorEntrada = new Map(entradas.map((e: any) => [e.id, e.data_entrada]))

  const itensManuais = entradas.length
    ? await paginar<any>(sb, 'entrada_itens',
        'entrada_id, produto_id, quantidade, preco_custo_novo',
        q => q.in('entrada_id', entradas.map((e: any) => e.id)))
    : []

  // ── Entradas por XML ──────────────────────────────────────────
  const nfeEntradas = await paginar<any>(sb, 'nfe_entradas',
    'id, fornecedor_id, data_entrada, data_importacao, pedido_compra_id',
    q => q.eq('empresa_id', empresaId).not('fornecedor_id', 'is', null))
  const fornecedorPorNfe = new Map(nfeEntradas.map((e: any) => [e.id, e.fornecedor_id]))
  const dataPorNfe = new Map(nfeEntradas.map((e: any) => [
    e.id, e.data_entrada ? `${e.data_entrada}T12:00:00Z` : e.data_importacao,
  ]))

  const itensNfe = nfeEntradas.length
    ? await paginar<any>(sb, 'nfe_itens',
        'entrada_id, produto_id, quantidade_entrada, custo_unitario',
        q => q.in('entrada_id', nfeEntradas.map((e: any) => e.id)))
    : []

  // ── Agregação por (fornecedor, produto) ──────────────────────
  const agregados = new Map<string, Agregado>()
  function registrar(fornecedorId: string | null, produtoId: string | null, data: string | null, custo: number, qtd: number) {
    if (!fornecedorId || !produtoId || !UUID.test(produtoId) || !data) return
    const chave = `${fornecedorId}::${produtoId}`
    const a = agregados.get(chave) ?? { custos: [], ultimoCusto: 0, ultimaCompra: '', ultimaQtd: 0, contadas: 0 }
    if (custo > 0) a.custos.push(custo)
    a.contadas++
    if (!a.ultimaCompra || data > a.ultimaCompra) { a.ultimaCompra = data; a.ultimoCusto = custo; a.ultimaQtd = qtd }
    agregados.set(chave, a)
  }

  for (const it of itensManuais) {
    registrar(
      fornecedorPorEntrada.get(it.entrada_id) ?? null, it.produto_id,
      dataPorEntrada.get(it.entrada_id) ?? null,
      Number(it.preco_custo_novo ?? 0), Number(it.quantidade ?? 0),
    )
  }
  for (const it of itensNfe) {
    registrar(
      fornecedorPorNfe.get(it.entrada_id) ?? null, it.produto_id,
      dataPorNfe.get(it.entrada_id) ?? null,
      Number(it.custo_unitario ?? 0), Number(it.quantidade_entrada ?? 0),
    )
  }

  // ── Prazo real ────────────────────────────────────────────────
  // Só existe para entradas que referenciam um pedido de compra — hoje
  // nenhuma referencia, porque o vínculo é novo. A partir da primeira
  // entrada vinculada, a amostra começa a se formar sozinha.
  const pedidoIds = new Set<string>()
  for (const e of entradas) if (e.pedido_compra_id) pedidoIds.add(e.pedido_compra_id)
  for (const e of nfeEntradas) if (e.pedido_compra_id) pedidoIds.add(e.pedido_compra_id)

  const prazosPorChave = new Map<string, number[]>()
  if (pedidoIds.size > 0) {
    const pedidos = await paginar<any>(sb, 'pedidos_compra', 'id, fornecedor_id, data_pedido',
      q => q.eq('empresa_id', empresaId).in('id', [...pedidoIds]))
    const dataPedido = new Map(pedidos.map((p: any) => [p.id, p.data_pedido]))
    const fornecedorDoPedido = new Map(pedidos.map((p: any) => [p.id, p.fornecedor_id]))

    function medirPrazo(pedidoCompraId: string | null, produtoId: string | null, dataChegada: string | null) {
      if (!pedidoCompraId || !produtoId || !dataChegada) return
      const dp = dataPedido.get(pedidoCompraId)
      const fid = fornecedorDoPedido.get(pedidoCompraId)
      if (!dp || !fid) return
      const dias = (new Date(dataChegada).getTime() - new Date(`${dp}T00:00:00Z`).getTime()) / 86_400_000
      if (dias < 0 || dias > 180) return   // fora disso é dado ruim, não prazo
      const chave = `${fid}::${produtoId}`
      const arr = prazosPorChave.get(chave) ?? []
      arr.push(dias)
      prazosPorChave.set(chave, arr)
    }

    for (const it of itensManuais) {
      const e = entradas.find((x: any) => x.id === it.entrada_id)
      if (e?.pedido_compra_id) medirPrazo(e.pedido_compra_id, it.produto_id, dataPorEntrada.get(it.entrada_id) ?? null)
    }
    for (const it of itensNfe) {
      const e = nfeEntradas.find((x: any) => x.id === it.entrada_id)
      if (e?.pedido_compra_id) medirPrazo(e.pedido_compra_id, it.produto_id, dataPorNfe.get(it.entrada_id) ?? null)
    }
  }

  // ── Gravação ──────────────────────────────────────────────────
  const linhas = [...agregados.entries()].map(([chave, a]) => {
    const [fornecedorId, produtoId] = chave.split('::')
    const prazos = prazosPorChave.get(chave)
    return {
      empresa_id: empresaId, fornecedor_id: fornecedorId, produto_id: produtoId,
      custo_ultimo: a.ultimoCusto || null,
      custo_medio: a.custos.length ? a.custos.reduce((s, c) => s + c, 0) / a.custos.length : null,
      custo_menor_recente: a.custos.length ? Math.min(...a.custos) : null,
      custo_maior_recente: a.custos.length ? Math.max(...a.custos) : null,
      quantidade_ultima: a.ultimaQtd || null,
      ultima_compra_em: a.ultimaCompra || null,
      compras_contadas: a.contadas,
      prazo_entrega_real_dias: prazos?.length ? Math.round((prazos.reduce((s, p) => s + p, 0) / prazos.length) * 10) / 10 : null,
      prazo_entrega_amostras: prazos?.length ?? 0,
      atualizado_em: new Date().toISOString(),
    }
  })

  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await sb.from('fornecedor_produto')
      .upsert(linhas.slice(i, i + 500), { onConflict: 'empresa_id,fornecedor_id,produto_id' })
    if (error) throw new Error(`gravar fornecedor_produto: ${error.message}`)
  }

  return {
    empresaId,
    linhas: linhas.length,
    comPrazoReal: linhas.filter(l => l.prazo_entrega_real_dias !== null).length,
    duracaoMs: Date.now() - t0,
  }
}
