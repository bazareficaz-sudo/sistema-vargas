// Sincronização de produtos vinculados entre empresas parceiras (mesmo
// tenant). Cada empresa mantém sua própria linha em `produtos` — este
// helper só propaga campos de IDENTIDADE (nome/descrição/categoria/marca/
// EAN) pro produto vinculado quando um deles é editado. Nunca propaga
// preço, estoque ou campos fiscais — cada empresa mantém os seus, sempre.
//
// Chamado depois que o UPDATE original já foi confirmado com sucesso, nos
// 3 pontos de edição mais usados (EditarProdutoModal, renomear inline em
// ProdutosClient, edição em massa em AcoesEmMassaModal) — não em todos os
// fluxos secundários que também tocam esses campos (ver plano).

export type CamposSincronizaveis = Partial<{
  nome: string
  descricao_marketplace: string | null
  categoria: string | null
  marca: string | null
  ean: string | null
}>

export async function sincronizarProdutoVinculado(sb: any, produtoId: string, campos: CamposSincronizaveis): Promise<void> {
  if (Object.keys(campos).length === 0) return

  const [vinculosA, vinculosB] = await Promise.all([
    sb.from('produto_vinculos').select('id, produto_id_b').eq('produto_id_a', produtoId),
    sb.from('produto_vinculos').select('id, produto_id_a').eq('produto_id_b', produtoId),
  ])

  const parceiros = [
    ...(vinculosA.data ?? []).map((v: any) => v.produto_id_b),
    ...(vinculosB.data ?? []).map((v: any) => v.produto_id_a),
  ]
  if (parceiros.length === 0) return

  await Promise.all(parceiros.map((parceiroId: string) =>
    sb.from('produtos').update(campos).eq('id', parceiroId)
  ))
}
