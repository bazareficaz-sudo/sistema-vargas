// Cálculo ao vivo de custo/estoque de um kit a partir dos componentes
// (kit_itens). Hoje esses valores só são gravados uma vez na criação do kit
// (CriarKitModal.tsx) e nunca recalculados ao editar a composição — isso
// deixa o preço/estoque do kit obsoleto. Este helper é usado tanto pelo
// botão "Recalcular" no EditarProdutoModal quanto antes de enviar preço/
// estoque de kits para a Shopee.

export type ResultadoKit = { custo: number; estoque: number }

export async function calcularKit(
  sb: any,
  produtoId: string,
  depositoId?: string | null
): Promise<ResultadoKit | null> {
  const { data: itens } = await sb
    .from('kit_itens')
    .select('produto_id, quantidade')
    .eq('kit_id', produtoId)

  if (!itens || itens.length === 0) return null

  const componenteIds = itens.map((i: any) => i.produto_id)
  const { data: componentes } = await sb
    .from('produtos')
    .select('id, preco_custo, estoque')
    .in('id', componenteIds)

  const estoquePorComponente = new Map<string, number>(
    (componentes ?? []).map((c: any) => [c.id, c.estoque ?? 0])
  )

  if (depositoId) {
    const { data: porDeposito } = await sb
      .from('produto_estoque')
      .select('produto_id, quantidade')
      .eq('deposito_id', depositoId)
      .in('produto_id', componenteIds)
    for (const row of porDeposito ?? []) {
      estoquePorComponente.set(row.produto_id, row.quantidade)
    }
  }

  let custo = 0
  let estoqueMinimo = Infinity
  for (const item of itens) {
    const componente = (componentes ?? []).find((c: any) => c.id === item.produto_id)
    if (!componente) continue
    custo += (componente.preco_custo ?? 0) * item.quantidade
    const estoqueComponente = estoquePorComponente.get(item.produto_id) ?? 0
    estoqueMinimo = Math.min(estoqueMinimo, Math.floor(estoqueComponente / item.quantidade))
  }

  return { custo, estoque: estoqueMinimo === Infinity ? 0 : Math.max(0, estoqueMinimo) }
}

// Quando um componente muda de custo/estoque (salvo como produto normal),
// os kits que o usam ficam desatualizados até alguém abrir e recalcular
// manualmente. Isso propaga o recálculo pra todos os kits que usam esse
// componente, gravando direto em `produtos`.
export async function recalcularKitsQueUsam(sb: any, componenteId: string): Promise<void> {
  const { data: itens } = await sb
    .from('kit_itens')
    .select('kit_id')
    .eq('produto_id', componenteId)

  const kitIds = [...new Set((itens ?? []).map((i: any): string => i.kit_id))]
  for (const kitId of kitIds) {
    const resultado = await calcularKit(sb, kitId)
    if (resultado) {
      await sb.from('produtos')
        .update({ preco_custo: resultado.custo, estoque: resultado.estoque, updated_at: new Date().toISOString() })
        .eq('id', kitId)
    }
  }
}
