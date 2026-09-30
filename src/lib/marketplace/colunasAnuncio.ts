// Colunas da LISTAGEM de anúncios — compartilhado entre o carregamento
// inicial (server, dashboard/marketplaces/[canalId]/anuncios/page.tsx) e o
// carregamento do catálogo completo sob demanda quando uma busca/filtro
// precisa dele (client, AnunciosClient.tsx). Um só lugar pra manter os dois
// carregamentos devolvendo exatamente a mesma forma de linha.
//
// De propósito não é `*`: `dados_brutos` (o payload cru da API do
// marketplace, guardado para depuração) pesa 85% do tamanho de cada linha e
// a tela usa só um campo dele, `listing_type_id` — extraído abaixo, o resto
// fica no banco. Medido em produção: com `*` um canal levava 33,7s/6,85MB
// pra carregar; com esta lista, 1,2s/0,97MB.
const COLUNAS_LISTAGEM_ANUNCIO = [
  'id', 'empresa_id', 'canal_id', 'produto_id', 'id_externo',
  // `descricao` fica DE FORA: pesada, usada só no formulário de edição, um
  // anúncio por vez — buscada sob demanda ao abrir a edição.
  'titulo', 'sku_canal', 'url_anuncio', 'imagens',
  'preco_venda', 'preco_promocional', 'promo_inicio', 'promo_fim',
  'estoque_externo', 'estoque_reservado', 'vendas',
  'status', 'status_externo', 'erro_msg', 'tem_variacao',
  'pausa_origem', 'pausa_em', 'pausa_motivo',
  'categoria_externa', 'marca_externa', 'regra_id',
  'ultima_atualizacao', 'ultima_atualizacao_externa', 'sincronizado_em',
  'created_at', 'updated_at',
  'frete_peso_cobravel', 'frete_logistic_type', 'frete_atualizado_em',
  'listing_type:dados_brutos->>listing_type_id',
  'qualidade_health', 'qualidade_score', 'qualidade_faltas', 'qualidade_em',
].join(', ')

export const SELECT_LISTAGEM_ANUNCIO =
  `${COLUNAS_LISTAGEM_ANUNCIO}, produtos(id, nome, sku, preco_venda, preco_custo, estoque, tipo, tags), marketplace_anuncio_variacoes(nome_variacao, sku_variacao, produto_id)`

/** Opções do seletor "carregar N anúncios" na tela de Anúncios. */
export const TAMANHOS_PAGINA_ANUNCIOS = [50, 100, 150, 200] as const
export type TamanhoPaginaAnuncios = (typeof TAMANHOS_PAGINA_ANUNCIOS)[number]

export function normalizarTamanhoPagina(valor: string | number | undefined): TamanhoPaginaAnuncios {
  const n = Number(valor)
  return (TAMANHOS_PAGINA_ANUNCIOS as readonly number[]).includes(n) ? (n as TamanhoPaginaAnuncios) : 50
}
