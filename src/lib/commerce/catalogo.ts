import { unstable_cache } from 'next/cache'
import { db, limpar } from './db'
import type {
  Banner, BlocoHome, Categoria, FiltrosBusca, Loja,
  ProdutoCard, ProdutoDetalhe, ResultadoBusca,
} from './tipos'

// Leitura do catálogo para a vitrine.
//
// Duas velocidades de dado, de propósito:
//
//   LISTAGEM  → `estoque_publicavel` vem do cache em loja_produtos, atualizado
//               pela publicação e pelo cron. Pode estar minutos velho.
//   PRODUTO / CARRINHO → `loja_estoque_disponivel()` ao vivo, sempre.
//
// É o desenho padrão de e-commerce. Calcular disponibilidade ao vivo para
// todo o catálogo a cada busca é o caminho conhecido para uma vitrine lenta;
// mas o momento em que o cliente decide comprar nunca pode usar número velho.

function paraCard(r: Record<string, any>): ProdutoCard {
  return {
    lojaProdutoId: r.loja_produto_id,
    produtoId: r.produto_id,
    slug: r.slug,
    nome: r.nome,
    marca: r.marca ?? null,
    imagemUrl: r.imagem_url ?? null,
    preco: Number(r.preco ?? 0),
    precoDe: r.preco_de != null ? Number(r.preco_de) : null,
    precoPix: r.preco_pix != null ? Number(r.preco_pix) : null,
    estoquePublicavel: Number(r.estoque_publicavel ?? 0),
    destaque: !!r.destaque,
  }
}

// ─── Busca e listagem ────────────────────────────────────────────────────────

/**
 * Uma função para busca E listagem de categoria: listar é buscar sem termo.
 * Duas implementações divergiriam — já aconteceu neste projeto com o filtro
 * de entrada de mercadoria, que virou um módulo compartilhado depois de as
 * duas cópias se afastarem.
 */
export async function buscar(loja: Loja, f: FiltrosBusca = {}): Promise<ResultadoBusca> {
  const porPagina = Math.min(Math.max(f.porPagina ?? 24, 1), 60)
  const pagina = Math.max(f.pagina ?? 1, 1)

  const { data, error } = await db().rpc('loja_buscar', {
    p_loja_id: loja.id,
    p_termo: f.termo?.trim() || null,
    p_categoria_id: f.categoriaId ?? null,
    p_marca: f.marca ?? null,
    p_preco_min: f.precoMin ?? null,
    p_preco_max: f.precoMax ?? null,
    p_so_promocao: f.soPromocao ?? false,
    p_so_disponivel: f.soDisponivel ?? false,
    p_ordem: f.ordem ?? 'relevancia',
    p_pagina: pagina,
    p_por_pagina: porPagina,
  })

  // Nunca tratar erro de consulta como "nenhum resultado". Uma busca quebrada
  // que devolve zero é indistinguível de um catálogo vazio — e o projeto já
  // perdeu dias assim, com a sincronização de marketplace parada em silêncio.
  if (error) {
    console.error('[commerce] loja_buscar falhou', { lojaId: loja.id, erro: error.message })
    throw new Error('Busca indisponível')
  }

  const linhas = (data ?? []) as Record<string, any>[]
  const total = linhas.length > 0 ? Number(linhas[0].total ?? 0) : 0

  return {
    produtos: linhas.map(l => paraCard(limpar(l))),
    total,
    pagina,
    porPagina,
    paginas: Math.max(Math.ceil(total / porPagina), 1),
  }
}

export async function sugerir(loja: Loja, termo: string) {
  const { data, error } = await db().rpc('loja_sugerir', {
    p_loja_id: loja.id, p_termo: termo, p_limite: 6,
  })
  if (error) return []
  return (data ?? []) as { slug: string; nome: string; imagem_url: string | null; preco: number }[]
}

// ─── Disponibilidade ao vivo ─────────────────────────────────────────────────

/**
 * Quanto dá para comprar AGORA. Sem cache, de propósito.
 *
 * Em lote porque o carrinho pergunta por vários itens de uma vez — e uma
 * chamada por item é como uma tela fica lenta sem ninguém entender por quê.
 */
export async function disponibilidadeAoVivo(
  loja: Loja, produtoIds: string[],
): Promise<Map<string, number>> {
  if (produtoIds.length === 0) return new Map()

  const { data, error } = await db().rpc('loja_estoque_disponivel', {
    p_loja_id: loja.id, p_produto_ids: produtoIds,
  })
  if (error) {
    console.error('[commerce] loja_estoque_disponivel falhou', error.message)
    // Devolver "tem estoque" num erro seria prometer o que não se sabe.
    // Zero faz a vitrine mostrar indisponível — conservador na direção certa.
    return new Map(produtoIds.map(id => [id, 0]))
  }

  return new Map(
    ((data ?? []) as Record<string, any>[]).map(r => [r.produto_id, Number(r.publicavel ?? 0)]),
  )
}

// ─── Página do produto ───────────────────────────────────────────────────────

export async function produtoPorSlug(loja: Loja, slug: string): Promise<ProdutoDetalhe | null> {
  const { data } = await db()
    .from('loja_vitrine_produtos')
    .select('*')
    .eq('loja_id', loja.id)
    .eq('slug', slug)
    .maybeSingle()

  if (!data) return null

  const r = limpar(data as Record<string, any>)

  // A página existe mesmo com o produto pausado ou fora de estoque. Tirar a
  // URL do ar quebraria link já compartilhado no WhatsApp e faria o Google
  // despublicar o endereço — semanas para recuperar. O que muda é o botão.
  if (r.status === 'nao_publicado') return null

  const { data: imgs } = await db()
    .from('loja_produto_imagens')
    .select('url, alt, ordem, principal')
    .eq('loja_produto_id', r.loja_produto_id)
    .order('principal', { ascending: false })
    .order('ordem')

  const galeria = ((imgs ?? []) as Record<string, any>[])
    .map(i => ({ url: String(i.url), alt: (i.alt as string | null) ?? null }))
  if (galeria.length === 0 && r.imagem_url) galeria.push({ url: String(r.imagem_url), alt: null })

  const disp = await disponibilidadeAoVivo(loja, [r.produto_id])

  const caracteristicas = Array.isArray(r.caracteristicas)
    ? (r.caracteristicas as unknown[]).map(String)
    : []
  const especificacoes =
    r.especificacoes && typeof r.especificacoes === 'object' && !Array.isArray(r.especificacoes)
      ? Object.fromEntries(Object.entries(r.especificacoes as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : {}

  return {
    ...paraCard(r),
    descricaoCurta: r.descricao_curta ?? null,
    descricaoCompleta: r.descricao_completa ?? null,
    caracteristicas,
    especificacoes,
    aplicacoes: r.aplicacoes ?? null,
    sku: r.sku ?? null,
    ean: r.ean ?? null,
    unidade: r.unidade ?? null,
    categoriaId: r.loja_categoria_id ?? null,
    seoTitle: r.seo_title ?? r.nome,
    metaDescription: r.meta_description ?? null,
    imagens: galeria,
    limiteMaximoPorCompra: r.limite_maximo_por_compra ?? loja.limiteMaximoPorCompra ?? null,
    disponivelAgora: disp.get(r.produto_id) ?? 0,
  }
}

/** Relacionados: mesma categoria, com saldo, sem repetir o próprio produto. */
export async function relacionados(loja: Loja, p: ProdutoDetalhe, limite = 8): Promise<ProdutoCard[]> {
  if (!p.categoriaId) return []
  const r = await buscar(loja, {
    categoriaId: p.categoriaId, soDisponivel: true, porPagina: limite + 1, ordem: 'relevancia',
  })
  return r.produtos.filter(x => x.produtoId !== p.produtoId).slice(0, limite)
}

// ─── Categorias ──────────────────────────────────────────────────────────────

async function lerCategorias(lojaId: string): Promise<Categoria[]> {
  const { data } = await db()
    .from('loja_categorias')
    .select('id, nome, slug, pai_id, imagem_url, descricao, destaque, ordem')
    .eq('loja_id', lojaId)
    .eq('ativo', true)
    .order('ordem')
    .order('nome')

  const linhas = (data ?? []) as Record<string, any>[]
  const porId = new Map<string, Categoria>()
  for (const l of linhas) {
    porId.set(l.id, {
      id: l.id, nome: l.nome, slug: l.slug, paiId: l.pai_id,
      imagemUrl: l.imagem_url, descricao: l.descricao, destaque: !!l.destaque, filhos: [],
    })
  }

  const raiz: Categoria[] = []
  for (const c of porId.values()) {
    const pai = c.paiId ? porId.get(c.paiId) : null
    if (pai) pai.filhos.push(c)
    else raiz.push(c)
  }
  return raiz
}

export function categorias(lojaId: string) {
  return unstable_cache(
    () => lerCategorias(lojaId),
    ['loja-categorias', lojaId],
    { revalidate: 300, tags: [`loja:${lojaId}`, `loja:${lojaId}:categorias`] },
  )()
}

/** Resolve o caminho `/c/hidraulica/tubos` até a folha. */
export async function categoriaPorCaminho(lojaId: string, caminho: string[]): Promise<{
  atual: Categoria | null; trilha: Categoria[]
}> {
  const arvore = await categorias(lojaId)
  const trilha: Categoria[] = []
  let nivel = arvore
  let atual: Categoria | null = null

  for (const parte of caminho) {
    const achado: Categoria | undefined = nivel.find(c => c.slug === parte)
    if (!achado) return { atual: null, trilha }
    trilha.push(achado)
    atual = achado
    nivel = achado.filhos
  }
  return { atual, trilha }
}

// ─── Home ────────────────────────────────────────────────────────────────────

async function lerBanners(lojaId: string): Promise<Banner[]> {
  const agora = new Date().toISOString()
  const { data } = await db()
    .from('loja_banners')
    .select('id, titulo, subtitulo, imagem_url, imagem_mobile_url, link_url, cta_texto, inicio_em, fim_em')
    .eq('loja_id', lojaId)
    .eq('posicao', 'hero')
    .eq('ativo', true)
    .order('ordem')

  return ((data ?? []) as Record<string, any>[])
    // Janela de vigência conferida aqui e não no banco porque `or` com duas
    // colunas nulas no PostgREST fica ilegível — e são poucos registros.
    .filter(b => (!b.inicio_em || b.inicio_em <= agora) && (!b.fim_em || b.fim_em >= agora))
    .map(b => ({
      id: b.id, titulo: b.titulo, subtitulo: b.subtitulo,
      imagemUrl: b.imagem_url, imagemMobileUrl: b.imagem_mobile_url,
      linkUrl: b.link_url, ctaTexto: b.cta_texto,
    }))
}

/**
 * Blocos da home.
 *
 * Quando a loja ainda não configurou nenhum, monta dois blocos padrão. Home
 * vazia numa loja recém-criada parece defeito; e o operador não deveria
 * precisar configurar nada para ver a vitrine em pé.
 */
async function montarBlocosHome(loja: Loja): Promise<BlocoHome[]> {
  const { data } = await db()
    .from('loja_blocos_home')
    .select('id, tipo, titulo, subtitulo, limite, config, ordem')
    .eq('loja_id', loja.id)
    .eq('ativo', true)
    .order('ordem')

  let definicoes = (data ?? []) as Record<string, any>[]
  if (definicoes.length === 0) {
    definicoes = [
      { id: 'padrao-ofertas', tipo: 'ofertas', titulo: 'Ofertas', subtitulo: null, limite: 8, config: {} },
      { id: 'padrao-novidades', tipo: 'novidades', titulo: 'Novidades', subtitulo: null, limite: 8, config: {} },
    ]
  }

  const blocos = await Promise.all(definicoes.map(async d => {
    const limite = Number(d.limite ?? 8)
    let produtos: ProdutoCard[] = []

    if (d.tipo === 'selecao') {
      const ids: string[] = Array.isArray(d.config?.produto_ids) ? d.config.produto_ids : []
      if (ids.length > 0) {
        const { data: linhas } = await db()
          .from('loja_vitrine_produtos').select('*')
          .eq('loja_id', loja.id).eq('status', 'publicado').in('produto_id', ids.slice(0, limite))
        produtos = ((linhas ?? []) as Record<string, any>[]).map(l => paraCard(limpar(l)))
      }
    } else {
      const r = await buscar(loja, {
        soPromocao: d.tipo === 'ofertas',
        soDisponivel: true,
        ordem: d.tipo === 'novidades' ? 'novidades' : 'relevancia',
        porPagina: limite,
      })
      produtos = r.produtos
      if (d.tipo === 'destaques') produtos = produtos.filter(p => p.destaque).slice(0, limite)
    }

    return {
      id: d.id, tipo: d.tipo, titulo: d.titulo, subtitulo: d.subtitulo ?? null,
      limite, produtos,
    } as BlocoHome
  }))

  // Bloco vazio não vai para a tela: buraco com título é pior que ausência.
  return blocos.filter(b => b.produtos.length > 0)
}

/** Marcas em destaque — as que mais aparecem no que está publicado e disponível. */
async function lerMarcas(lojaId: string, limite = 12): Promise<string[]> {
  const { data } = await db()
    .from('loja_produtos')
    .select('marca_vitrine')
    .eq('loja_id', lojaId)
    .eq('status', 'publicado')
    .not('marca_vitrine', 'is', null)
    .gt('estoque_publicavel', 0)
    .limit(2000)

  const contagem = new Map<string, number>()
  for (const l of (data ?? []) as Record<string, any>[]) {
    const m = (l.marca_vitrine as string).trim()
    if (m) contagem.set(m, (contagem.get(m) ?? 0) + 1)
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, limite).map(e => e[0])
}


// ─── Cache da home ───────────────────────────────────────────────────────────
//
// A home NÃO é estática, e não tem como ser: a loja é resolvida pelo hostname,
// então `headers()` entra na renderização e o Next serve a rota sob demanda —
// o `export const revalidate` da página, sozinho, não guarda nada.
//
// Foi o build que mostrou isso: a rota saiu marcada como dinâmica. Sem o
// cache abaixo, cada visita à home refaria a rodada inteira de consultas
// (blocos, banners, marcas) contra o MESMO Supabase que atende o PDV.
//
// Então o cache é de DADO, e não de página: a montagem da home custa uma
// rodada a cada 5 minutos por loja, e o resto das visitas é servido de
// memória. É por isso também que as funções acima ganharam nome próprio
// (`montarBlocosHome`, `lerBanners`, `lerMarcas`) — o que a vitrine importa
// é sempre a versão cacheada.

export function banners(lojaId: string): Promise<Banner[]> {
  return unstable_cache(
    () => lerBanners(lojaId),
    ['loja-banners', lojaId],
    { revalidate: 300, tags: [`loja:${lojaId}`] },
  )()
}

export function marcasEmDestaque(lojaId: string, limite = 12): Promise<string[]> {
  return unstable_cache(
    () => lerMarcas(lojaId, limite),
    ['loja-marcas', lojaId, String(limite)],
    { revalidate: 600, tags: [`loja:${lojaId}`] },
  )()
}

export function blocosHome(loja: Loja): Promise<BlocoHome[]> {
  return unstable_cache(
    () => montarBlocosHome(loja),
    ['loja-blocos', loja.id],
    { revalidate: 300, tags: [`loja:${loja.id}`] },
  )()
}
