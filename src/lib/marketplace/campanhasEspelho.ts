import { normalizarCampanhaDoEspelho, type CampanhaDoAnuncio } from '@/lib/precificacao/campanhas'

// A LEITURA DO ESPELHO DE CAMPANHAS, em um lugar só.
//
// Existe por causa de um defeito real, encontrado em 04/09/2026: a consulta de
// `contexto.ts` trazia os itens da campanha SEM a coluna `status`. O
// normalizador então recebia `undefined`, e `statusCanonicoDoItem` traduz
// ausência como `desconhecido` — de propósito, para que um status novo do
// marketplace nunca ganhe o direito de mexer em preço por omissão.
//
// A consequência: `itemDoAnuncio` só aceita `participando`, então NENHUM item
// passava. O preço de campanha nunca chegava a valer na precificação, as
// oportunidades nunca apareciam, e a tela ficava idêntica à de quem não tem
// campanha nenhuma. A regra de segurança estava certa; faltava a coluna na
// consulta.
//
// A COLUNA PODE NÃO EXISTIR. `marketplace_promocao_itens.status` foi criada em
// `supabase-campanhas-fase4.sql`, que não está em `supabase/migrations/` e cuja
// aplicação em produção não pôde ser confirmada. Por isso a leitura tenta com
// a coluna e, se o banco recusar, repete sem ela — e aí assume
// `participando`, que é o que a Shopee significa: lá, estar na campanha É
// participar (o próprio arquivo da migration diz isso). O ML é que traz
// convidados, e o sync de ML ainda não existe.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any

const SEM_STATUS = `
  id, empresa_id, canal_id, id_externo, nome, status, inicio, fim, sincronizado_em, dados_brutos,
  marketplace_promocao_itens (
    id, anuncio_id, item_id_externo, model_id,
    preco_original, preco_promocional, limite_por_compra, estoque_promocao
  )
`

const COM_STATUS = `
  id, empresa_id, canal_id, id_externo, nome, tipo, status, inicio, fim, sincronizado_em, dados_brutos,
  marketplace_promocao_itens (
    id, anuncio_id, item_id_externo, model_id, status, status_externo,
    preco_original, preco_promocional, limite_por_compra, estoque_promocao,
    preco_minimo_marketplace, preco_sugerido_marketplace, pct_marketplace, pct_vendedor
  )
`

/**
 * Campanhas não encerradas de um canal, com os itens, já normalizadas.
 *
 * `neq('status','encerrada')` continua: campanha encerrada não compromete
 * preço nenhum e só faria a consulta crescer com histórico.
 */
export async function campanhasDoCanalNoEspelho(
  sb: ClienteSupabase,
  empresaId: string,
  canal: { id: string; plataforma: string },
): Promise<CampanhaDoAnuncio[]> {
  const consulta = (colunas: string) => sb
    .from('marketplace_promocoes')
    .select(colunas)
    // Empresa E canal: a campanha é da empresa da sessão, e id de canal nunca
    // é identificador suficiente sozinho.
    .eq('empresa_id', empresaId)
    .eq('canal_id', canal.id)
    .neq('status', 'encerrada')

  const primeira = await consulta(COM_STATUS)
  let data = primeira.data
  let colunaDeStatusExiste = true

  if (primeira.error) {
    // Só o caminho de coluna ausente cai aqui com sentido; qualquer outro erro
    // devolve lista vazia do mesmo jeito que devolvia antes.
    const retry = await consulta(SEM_STATUS)
    data = retry.data
    colunaDeStatusExiste = false
    if (retry.error) return []
  }

  return (data ?? []).map((linha: Record<string, unknown>) => {
    const bruta = colunaDeStatusExiste ? linha : comStatusPresumido(linha)
    return normalizarCampanhaDoEspelho(bruta as never, canal, empresaId)
  })
}

/**
 * Sem a coluna no banco, todo item vira `participando`.
 *
 * É suposição, e por isso está isolada aqui com nome que diz o que é. Vale
 * para a Shopee, a única plataforma que hoje alimenta esta tabela.
 */
function comStatusPresumido(linha: Record<string, unknown>) {
  const itens = (linha.marketplace_promocao_itens ?? []) as Record<string, unknown>[]
  return { ...linha, marketplace_promocao_itens: itens.map(i => ({ ...i, status: 'participando' })) }
}
