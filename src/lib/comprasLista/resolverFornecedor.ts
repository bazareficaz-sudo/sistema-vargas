import { sugerirFornecedor, type OpcaoFornecedor } from '@/lib/fornecedores/sugestao'

// Decide o fornecedor de um item ao entrar na lista de compra.
//
// Ordem de decisão: fornecedor padrão do produto (o comprador já escolheu
// isso uma vez, no cadastro) > sugestão calculada a partir do histórico
// (preço, prazo, confiabilidade) > nenhum, o item entra sem fornecedor e
// fica esperando na tela.
//
// Isto só chuta um PONTO DE PARTIDA. A lista sempre permite trocar — a
// decisão final continua sendo do comprador.

export async function resolverFornecedorSugerido(
  sb: any, empresaId: string, produtoId: string,
): Promise<{ fornecedorId: string | null; custoEstimado: number | null }> {
  const { data: produto } = await sb.from('produtos')
    .select('fornecedor_padrao_id, preco_custo').eq('id', produtoId).maybeSingle()

  const { data: linhas } = await sb.from('fornecedor_produto')
    .select('fornecedor_id, custo_ultimo, prazo_entrega_real_dias, prazo_entrega_dias, quantidade_minima, compras_contadas, ultima_compra_em, preferencial')
    .eq('empresa_id', empresaId).eq('produto_id', produtoId)

  if (produto?.fornecedor_padrao_id) {
    const daFonte = (linhas ?? []).find((l: any) => l.fornecedor_id === produto.fornecedor_padrao_id)
    return {
      fornecedorId: produto.fornecedor_padrao_id,
      custoEstimado: daFonte?.custo_ultimo ?? produto.preco_custo ?? null,
    }
  }

  if (!linhas || linhas.length === 0) {
    return { fornecedorId: null, custoEstimado: produto?.preco_custo ?? null }
  }

  const opcoes: OpcaoFornecedor[] = linhas.map((l: any) => ({
    fornecedorId: l.fornecedor_id, nome: '',
    custoUltimo: l.custo_ultimo, prazoDias: l.prazo_entrega_real_dias ?? l.prazo_entrega_dias,
    prazoReal: l.prazo_entrega_real_dias !== null, comprasContadas: l.compras_contadas,
    ultimaCompraEm: l.ultima_compra_em, preferencial: l.preferencial, quantidadeMinima: l.quantidade_minima,
  }))
  const recomendacao = sugerirFornecedor(opcoes)
  const vencedor = recomendacao ? linhas.find((l: any) => l.fornecedor_id === recomendacao.fornecedorId) : null

  return {
    fornecedorId: recomendacao?.fornecedorId ?? null,
    custoEstimado: vencedor?.custo_ultimo ?? produto?.preco_custo ?? null,
  }
}
