import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import AnunciosClient from '@/components/marketplaces/AnunciosClient'
import { buscarConfigDoCanal } from '@/lib/precificacao/config'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

// Colunas da LISTAGEM — de propósito não é `*`.
//
// `dados_brutos` (o payload cru da API do marketplace, guardado para
// depuração) pesa 3.586 dos 4.208 bytes de cada linha: 85% do total. A tela
// não mostra nada dele; usa um campo só, `listing_type_id`, para dizer se o
// anúncio do Mercado Livre é Clássico ou Premium. Então esse campo vem
// extraído, e o blob fica no banco.
//
// Medido em produção (11/08/2026), este canal e o do ML:
//   com `*`         → Shp Eficaz 8,4 s / 3,44 MB · ML Eficaz 33,7 s / 6,85 MB
//   com esta lista  → 1,2 s / 0,70 MB · 1,2 s / 0,97 MB
//
// Ao adicionar coluna nova na tabela, ela NÃO aparece aqui sozinha — é o
// preço de não usar `*`, e é um preço que vale a pena.
const COLUNAS_LISTAGEM = [
  'id', 'empresa_id', 'canal_id', 'produto_id', 'id_externo',
  // `descricao` fica DE FORA: 551 KB nos 789 anúncios de um canal, usada só
  // no formulário de edição, um anúncio por vez. É buscada sob demanda ao
  // abrir a edição (ver abrirEditar em AnunciosClient.tsx).
  'titulo', 'sku_canal', 'url_anuncio', 'imagens',
  'preco_venda', 'preco_promocional', 'promo_inicio', 'promo_fim',
  'estoque_externo', 'estoque_reservado', 'vendas',
  'status', 'status_externo', 'erro_msg', 'tem_variacao',
  'categoria_externa', 'marca_externa', 'regra_id',
  'ultima_atualizacao', 'ultima_atualizacao_externa', 'sincronizado_em',
  'created_at', 'updated_at',
  'frete_peso_cobravel', 'frete_logistic_type', 'frete_atualizado_em',
  // Único pedaço de dados_brutos que a tela lê, extraído sem trazer o resto.
  'listing_type:dados_brutos->>listing_type_id',
  // Qualidade — calculada a cada sincronização (src/lib/marketplace/qualidade.ts),
  // nunca aqui na tela. Leve: 4 colunas escalares, nada parecido com o peso
  // de `dados_brutos`.
  'qualidade_health', 'qualidade_score', 'qualidade_faltas', 'qualidade_em',
].join(', ')

export default async function AnunciosPage({ params, searchParams }: {
  params: Promise<{ canalId: string }>
  // Os filtros da tela viajam na URL para sobreviverem à troca de canal —
  // trocar de canal é uma navegação, e o estado do client component morre
  // nela. `q` e `status` a consulta abaixo usa; `tag`, `falta` e `facetas`
  // são filtrados na tela e só passam por aqui de carona, para voltarem
  // preenchidos do outro lado.
  searchParams: Promise<{ q?: string; status?: string; tag?: string; falta?: string; facetas?: string }>
}) {
  const { canalId } = await params
  const { q = '', status = '', tag = '', falta = '', facetas = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  const { data: canal } = await supabase
    .from('marketplace_canais')
    .select('*')
    .eq('id', canalId)
    .eq('empresa_id', empresaId)
    .single()

  if (!canal) notFound()

  const { data: canais } = await supabase
    .from('marketplace_canais')
    // plataforma entra pra tela saber quais canais aceitam replicação em
    // massa (só vale entre contas do mesmo marketplace).
    .select('id, nome, plataforma, ativo')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  // O projeto Supabase tem "Max Rows" do PostgREST em 1000 — um .limit(5000)
  // único fica travado em 1000 linhas silenciosamente, mesmo com bem mais
  // anúncios cadastrados (confirmado ao vivo: canal com 4999 linhas na
  // tabela só devolvia 1000). Pagina em blocos de 1000 via .range() até
  // esgotar, em vez de confiar num limit alto.
  const TAMANHO_PAGINA = 1000
  const anuncios: any[] = []
  for (let offset = 0; offset < 20 * TAMANHO_PAGINA; offset += TAMANHO_PAGINA) {
    let pagina = supabase
      .from('marketplace_anuncios')
      .select(`${COLUNAS_LISTAGEM}, produtos(id, nome, sku, preco_venda, preco_custo, estoque, tipo, tags), marketplace_anuncio_variacoes(nome_variacao, sku_variacao, produto_id)`)
      .eq('canal_id', canalId)
      .order('created_at', { ascending: false })
      .range(offset, offset + TAMANHO_PAGINA - 1)
    // Os filtros da URL NÃO recortam esta consulta, embora recortassem antes.
    //
    // Eles existem hoje para atravessar a troca de canal, e são aplicados na
    // tela. Se recortassem aqui também, a lista chegaria pela metade e o
    // campo de busca passaria a mentir: apagar uma letra de "corrente" para
    // procurar "corda" não acharia nada — não porque não exista, mas porque
    // o servidor nunca mandou. O usuário veria a busca simplesmente parar de
    // funcionar depois de trocar de canal.
    //
    // O custo é carregar o canal inteiro, que é o que já acontecia em toda
    // abertura normal da tela (medição no comentário das colunas, acima).
    const { data } = await pagina
    anuncios.push(...(data ?? []))
    if (!data || data.length < TAMANHO_PAGINA) break
  }

  // A busca de produto no modal de vínculo consulta o banco ao vivo
  // (ver AnunciosClient.tsx), então essa lista só serve como valor inicial/
  // fallback — não precisa (nem deve) tentar carregar o catálogo inteiro aqui.
  const { data: produtos } = await supabase
    .from('produtos')
    .select('id, nome, sku, preco_venda, preco_custo, estoque, ativo')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('nome')
    .limit(50)

  const { data: regras } = await supabase
    .from('marketplace_regras_preco')
    .select('*')
    .eq('canal_id', canalId)
    .eq('ativo', true)
    .order('nome')

  const { data: depositos } = await supabase
    .from('depositos')
    .select('id, nome')
    .eq('empresa_id', empresaId)
    .order('nome')

  // Taxas do canal: a listagem usa pra calcular a margem real de cada anúncio
  // (o mesmo motor da tela de Precificação, sem refazer conta).
  const { cfg: configPreco } = await buscarConfigDoCanal(supabase, empresaId, canal)

  return (
    <AnunciosClient
      canal={canal}
      configPreco={configPreco}
      canais={canais ?? []}
      anuncios={anuncios ?? []}
      produtos={produtos ?? []}
      empresaId={empresaId}
      qInicial={q}
      statusInicial={status}
      tagInicial={tag}
      faltaInicial={falta}
      facetasIniciais={facetas ? facetas.split(',').filter(Boolean) : []}
      operador={user?.email ?? ''}
      regras={regras ?? []}
      depositos={depositos ?? []}
    />
  )
}
