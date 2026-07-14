export function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

// Um anúncio só "diverge" se estiver vinculado a um produto — sem vínculo
// não há com o que comparar preço/estoque.
export function temDivergencia(a: any): boolean {
  if (!a.produto_id || !a.produtos) return false
  const precoDiverge = Number(a.preco_venda) !== Number(a.produtos.preco_venda)
  const estoqueDiverge = (a.estoque_externo ?? 0) !== (a.produtos.estoque ?? 0)
  return precoDiverge || estoqueDiverge
}
