// Sincronização de produtos vinculados entre empresas parceiras (mesmo
// tenant). Cada empresa mantém sua própria linha em `produtos` — este
// helper propaga campos de IDENTIDADE (nome/descrição/categoria/marca/EAN)
// pro produto vinculado sempre que um deles é editado. Nunca propaga
// estoque ou campos fiscais — isso é fato físico e depende do regime
// tributário de cada empresa, então cada empresa mantém os seus, sempre.
//
// Preço (preco_venda/preco_custo/markup) é a exceção: propaga SÓ quando a
// parceria específica tem `empresa_parcerias.sincronizar_preco = true` —
// desligado por padrão. Existe pra quem gerencia várias lojas com o mesmo
// produto e não quer manter uma tabela de preço/custo por loja; quem não
// liga o toggle continua com o comportamento de sempre (preço independente).
//
// Chamado depois que o UPDATE original já foi confirmado com sucesso, nos
// pontos de edição mais usados (EditarProdutoModal, renomear inline em
// ProdutosClient, edição em massa em AcoesEmMassaModal, PrecosClient) — não
// em todos os fluxos secundários que também tocam esses campos (ver plano).

export type CamposSincronizaveis = Partial<{
  nome: string
  descricao_marketplace: string | null
  categoria: string | null
  // Subcategoria acompanha a categoria: propagar uma sem a outra deixaria o
  // produto da empresa parceira com "MATERIAL HIDRÁULICO / Alicates".
  subcategoria: string | null
  marca: string | null
  ean: string | null
}>

// Promoção entra aqui junto com o preço normal, e não como "decisão tática
// de cada loja" (que foi a primeira leitura, e estava errada): quando a
// promoção está ativa, é `preco_promocional` que o PDV cobra do cliente.
// Sincronizar só `preco_venda` deixaria a loja parceira cobrando o preço
// cheio enquanto a outra cobra o promocional — uma sincronização pela
// metade, que engana mais do que ajuda. Medido numa entrada real: 35 de 36
// produtos tinham promoção ativa numa empresa e nenhuma na outra.
export type CamposPreco = Partial<{
  preco_venda: number
  preco_custo: number | null
  markup: number | null
  preco_promocional: number | null
  promocao_ativa: boolean
  promocao_inicio: string | null
  promocao_fim: string | null
}>

export async function sincronizarProdutoVinculado(
  sb: any,
  produtoId: string,
  campos: CamposSincronizaveis,
  precos?: CamposPreco,
): Promise<void> {
  const temIdentidade = Object.keys(campos).length > 0
  const temPreco = !!precos && Object.keys(precos).length > 0
  if (!temIdentidade && !temPreco) return

  const [vinculosA, vinculosB] = await Promise.all([
    sb.from('produto_vinculos').select('id, produto_id_b, parceria_id').eq('produto_id_a', produtoId),
    sb.from('produto_vinculos').select('id, produto_id_a, parceria_id').eq('produto_id_b', produtoId),
  ])

  const vinculos: { parceiroId: string; parceriaId: string }[] = [
    ...(vinculosA.data ?? []).map((v: any) => ({ parceiroId: v.produto_id_b as string, parceriaId: v.parceria_id as string })),
    ...(vinculosB.data ?? []).map((v: any) => ({ parceiroId: v.produto_id_a as string, parceriaId: v.parceria_id as string })),
  ]
  if (vinculos.length === 0) return

  let parceriasComSyncPreco = new Set<string>()
  if (temPreco) {
    const parceriaIds = Array.from(new Set(vinculos.map(v => v.parceriaId)))
    const { data: parcerias } = await sb.from('empresa_parcerias')
      .select('id, sincronizar_preco').in('id', parceriaIds)
    parceriasComSyncPreco = new Set<string>(
      (parcerias ?? []).filter((p: any) => p.sincronizar_preco).map((p: any) => p.id as string)
    )
  }

  await Promise.all(vinculos.map(({ parceiroId, parceriaId }) => {
    const camposParaEste = temPreco && parceriasComSyncPreco.has(parceriaId)
      ? { ...campos, ...precos }
      : campos
    if (Object.keys(camposParaEste).length === 0) return Promise.resolve()
    return sb.from('produtos').update(camposParaEste).eq('id', parceiroId)
  }))
}
