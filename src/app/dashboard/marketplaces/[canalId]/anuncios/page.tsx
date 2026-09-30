import { createClient } from '@/lib/supabase/server'
import { campanhasDoCanalNoEspelho } from '@/lib/marketplace/campanhasEspelho'
import { selosPorAnuncio } from '@/lib/marketplace/seloCampanha'
import { notFound } from 'next/navigation'
import AnunciosClient from '@/components/marketplaces/AnunciosClient'
import { buscarConfigDoCanal } from '@/lib/precificacao/config'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import { SELECT_LISTAGEM_ANUNCIO, normalizarTamanhoPagina } from '@/lib/marketplace/colunasAnuncio'
import { PLATAFORMA_LOJA_ONLINE } from '@/lib/marketplace/canais'

export const dynamic = 'force-dynamic'

export default async function AnunciosPage({ params, searchParams }: {
  params: Promise<{ canalId: string }>
  // Os filtros da tela viajam na URL para sobreviverem à troca de canal —
  // trocar de canal é uma navegação, e o estado do client component morre
  // nela. `q`, `status`, `tag`, `falta` e `facetas` são filtrados na tela e
  // só passam por aqui de carona, para voltarem preenchidos do outro lado.
  // `tamanho` é o único que a consulta abaixo usa de verdade — quantos
  // anúncios carregar de cara (ver normalizarTamanhoPagina).
  searchParams: Promise<{ q?: string; status?: string; tag?: string; falta?: string; facetas?: string; tamanho?: string }>
}) {
  const { canalId } = await params
  const { q = '', status = '', tag = '', falta = '', facetas = '', tamanho } = await searchParams
  const tamanhoPagina = normalizarTamanhoPagina(tamanho)
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
  // A SIMULACAO DA EMPRESA e o padrao que o canal pode sobrepor. A coluna
  // "Regra" da listagem precisa das duas para dizer se o anuncio esta mesmo
  // enviando — ver src/lib/marketplace/estadoRegra.ts.
  const { data: filaCfg } = await supabase
    .from('marketplace_fila_config')
    // `ativo` junto: com a fila desligada NENHUMA rodada acontece, e a coluna
    // "Regra" dizia "enviando" mesmo assim. Ver estadoRegra.ts.
    .select('simulacao, ativo').eq('empresa_id', empresaId).maybeSingle()

  // CAMPANHAS NAO ENCERRADAS deste canal, para o botao "Por em promocao".
  // So as que ainda aceitam item: acrescentar numa encerrada seria uma
  // chamada que a Shopee recusa, depois de a pessoa ja ter escolhido tudo.
  const { data: campanhasRows } = await supabase
    .from('marketplace_promocoes')
    .select('id_externo, nome, status')
    .eq('canal_id', canalId).neq('status', 'encerrada')
    .order('inicio', { ascending: false })

  if (!canal) notFound()

  // OS SELOS: quais anúncios estão comprometidos com campanha, e até quando.
  //
  // Mesma leitura da precificação, mesma função de selo — as duas telas
  // respondem a mesma pergunta e não podem divergir. Calculado no servidor
  // para o relógio ser um só: "faltam 3 dias" medido no navegador de quem
  // abre daria resposta diferente por fuso.
  const campanhasComItens = await campanhasDoCanalNoEspelho(
    supabase, empresaId, { id: canalId, plataforma: canal.plataforma })
  const selos = selosPorAnuncio(campanhasComItens, new Date())

  const { data: canais } = await supabase
    .from('marketplace_canais')
    // plataforma entra pra tela saber quais canais aceitam replicação em
    // massa (só vale entre contas do mesmo marketplace).
    .select('id, nome, plataforma, ativo')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true })

  // Carrega só os primeiros `tamanhoPagina` anúncios (padrão 50) — abrir um
  // canal com milhares de anúncios não precisa trazer todos de cara. Os
  // filtros da URL NÃO recortam esta consulta (mesmo motivo de sempre: são
  // aplicados na tela, e servem pra atravessar a troca de canal). Quando o
  // usuário busca ou ativa um filtro com a lista parcial carregada,
  // `AnunciosClient` busca o catálogo completo por conta própria (mesma
  // forma de linha, via SELECT_LISTAGEM_ANUNCIO) — ver carregarCatalogoCompleto
  // lá. O total do canal (contagem, não os dados) vem à parte pra tela saber
  // se "carregou tudo" ou se há mais por trás do que veio.
  const [{ data: anuncios }, { count: totalAnuncios }] = await Promise.all([
    supabase
      .from('marketplace_anuncios')
      .select(SELECT_LISTAGEM_ANUNCIO)
      .eq('canal_id', canalId)
      .order('created_at', { ascending: false })
      .range(0, tamanhoPagina - 1),
    supabase
      .from('marketplace_anuncios')
      .select('id', { count: 'exact', head: true })
      .eq('canal_id', canalId),
  ])

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
      simulacaoDaEmpresa={filaCfg?.simulacao ?? true}
      filaAtiva={filaCfg?.ativo ?? null}
      campanhasAtivas={(campanhasRows ?? []).map(c => ({ idExterno: String(c.id_externo), nome: c.nome, status: c.status }))}
      selosCampanha={selos}
      canal={canal}
      configPreco={configPreco}
      // Seletor de canal e destinos de replicação: só canais ativos e que têm
      // anúncio (a Loja Online não tem). O canal aberto fica na lista mesmo se
      // desativado, senão o seletor mostraria outro canal selecionado.
      canais={(canais ?? []).filter(c =>
        c.id === canalId || (c.ativo !== false && c.plataforma !== PLATAFORMA_LOJA_ONLINE))}
      anuncios={anuncios ?? []}
      totalCanal={totalAnuncios ?? (anuncios ?? []).length}
      tamanhoInicial={tamanhoPagina}
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
