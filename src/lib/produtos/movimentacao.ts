// Logger compartilhado pra estoque_movimentacoes — usado pelos fluxos que
// hoje só mexem em produtos.estoque direto (venda/devolução no PDV, entrada
// de mercadoria manual e por XML, ajuste no cadastro do produto) sem deixar
// rastro nenhum. Os 3 escritores que já existiam (venda_marketplace em
// src/lib/produtos/estoque.ts, transferência em DetalheDepositoClient.tsx e
// ajuste_entrada/ajuste_saida por inventário em InventarioDetalheClient.tsx)
// não foram alterados — este helper só padroniza os pontos novos.

export type TipoMovimento = 'venda' | 'devolucao' | 'entrada_compra' | 'entrada_nfe' | 'ajuste_entrada' | 'ajuste_saida'

export async function registrarMovimentoEstoque(sb: any, params: {
  empresaId: string
  depositoId?: string | null
  produtoId: string
  produtoNome: string
  tipo: TipoMovimento
  quantidade: number
  estoqueAnterior: number
  estoqueNovo: number
  motivo?: string | null
  referenciaId?: string | null
  referenciaTipo?: string | null
  usuario?: string | null
  observacao?: string | null
}): Promise<void> {
  await sb.from('estoque_movimentacoes').insert({
    empresa_id: params.empresaId,
    deposito_id: params.depositoId ?? null,
    produto_id: params.produtoId,
    produto_nome: params.produtoNome,
    tipo: params.tipo,
    quantidade: params.quantidade,
    estoque_anterior: params.estoqueAnterior,
    estoque_novo: params.estoqueNovo,
    motivo: params.motivo ?? null,
    referencia_id: params.referenciaId ?? null,
    referencia_tipo: params.referenciaTipo ?? null,
    usuario: params.usuario ?? null,
    observacao: params.observacao ?? null,
  })
}

export async function buscarDepositoPrincipal(sb: any, empresaId: string): Promise<string | null> {
  const { data } = await sb.from('depositos')
    .select('id').eq('empresa_id', empresaId).eq('principal', true).maybeSingle()
  return data?.id ?? null
}
