import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { refreshAccessTokenIfNeeded } from '@/lib/mercadolivre/client'
import type { MLChannel } from '@/lib/mercadolivre/types'

// SONDA DE CAPACIDADE — família /seller-promotions do Mercado Livre.
//
// SOMENTE LEITURA. Todas as chamadas daqui são GET. Nenhuma entra em
// campanha, cria promoção ou altera preço. Se um dia a escrita entrar, ela
// não entra NESTE arquivo.
//
// POR QUE ESTA ROTA EXISTE
//
// `adaptadores.ts` marca o Mercado Livre como `disponivel: false` com seis
// perguntas em aberto, porque a documentação oficial responde 403 a este
// ambiente e não havia como sondar a API real. Escrever o cliente a partir
// de resumo de busca repetiria o erro que a publicação na Shopee custou:
// contrato descoberto erro a erro, contra produção.
//
// A alternativa honesta é medir. É o mesmo caminho que resolveu comissão
// (`mlComissao.ts`) e frete (`mlFrete.ts`): um GET autenticado contra a
// conta real vale mais que qualquer documentação inacessível.
//
// POR QUE NÃO USA `mlGet`
//
// `mlGet` lança `MLApiError` em qualquer resposta não-ok — e perde o número
// que aqui é a resposta inteira. Para uma sonda, 401, 403, 404 e 200 dizem
// coisas DIFERENTES:
//
//   200 → o endpoint existe e o token alcança
//   401 → token inválido/expirado (é falha nossa, não do escopo)
//   403 → o endpoint existe mas o token NÃO tem escopo — precisa reautorizar
//   404 → o caminho não é esse (o resumo de busca estava errado)
//
// Colapsar os quatro em "erro" seria trocar a medição por um palpite, que é
// exatamente o que esta rota existe para não fazer.
//
// O token nunca sai daqui: vai no header, e não aparece em nenhum campo da
// resposta.

const API = 'https://api.mercadolibre.com'
const APP_VERSION = 'v2'

// Quantos tipos de campanha sondar por canal. Limite existe por educação com
// a plataforma: a conta tem 16 campanhas, e sondar todas responderia a mesma
// pergunta muitas vezes.
const MAX_TIPOS = 3

type Sonda = {
  responde: string
  caminho: string
  status: number | null
  ok: boolean
  formato?: string
  chaves?: string[]
  amostra?: unknown
  erro?: string
  rateLimit?: Record<string, string>
}

/**
 * Descreve o FORMATO de uma resposta sem despejar a resposta inteira.
 *
 * A pergunta que a sonda responde é "que campos existem", não "quais são os
 * valores" — e um dump completo de campanhas encheria a tela de ruído.
 */
function descreverFormato(body: unknown): { formato: string; chaves: string[] } {
  if (body === null || body === undefined) return { formato: 'vazio', chaves: [] }
  if (Array.isArray(body)) {
    const primeiro = body[0]
    const chaves = primeiro && typeof primeiro === 'object' ? Object.keys(primeiro as object) : []
    return { formato: `array[${body.length}]`, chaves }
  }
  if (typeof body === 'object') {
    const obj = body as Record<string, unknown>
    const chaves = Object.keys(obj)
    // O ML costuma embrulhar a lista em { results: [...] } ou { paging, results }.
    const lista = Array.isArray(obj.results) ? obj.results : null
    if (lista) {
      const primeiro = lista[0]
      const internas = primeiro && typeof primeiro === 'object' ? Object.keys(primeiro as object) : []
      return {
        formato: `objeto{${chaves.join(', ')}} · results[${lista.length}]`,
        chaves: internas,
      }
    }
    return { formato: 'objeto', chaves }
  }
  return { formato: typeof body, chaves: [] }
}

/** Cabeçalhos de limite de uso, quando a plataforma os manda. Responde a pergunta 6. */
function limitesDe(res: Response): Record<string, string> | undefined {
  const achados: Record<string, string> = {}
  res.headers.forEach((valor, nome) => {
    if (nome.toLowerCase().includes('ratelimit') || nome.toLowerCase() === 'retry-after') {
      achados[nome] = valor
    }
  })
  return Object.keys(achados).length > 0 ? achados : undefined
}

/**
 * Faz um GET e descreve o que voltou.
 *
 * Devolve o corpo junto com a sonda porque a segunda rodada depende da
 * primeira: os ids de campanha só existem depois de perguntar. O corpo NÃO
 * entra no relatório — só a descrição entra.
 */
async function sondar(responde: string, caminho: string, token: string): Promise<{ sonda: Sonda; body: unknown }> {
  const url = `${API}${caminho}`
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const bruto = await res.text()
    let body: unknown = null
    try { body = bruto ? JSON.parse(bruto) : null } catch { body = bruto.slice(0, 300) }

    const base: Sonda = {
      responde, caminho,
      status: res.status,
      ok: res.ok,
      rateLimit: limitesDe(res),
    }
    if (!res.ok) {
      return {
        sonda: { ...base, erro: typeof bruto === 'string' ? bruto.slice(0, 500) : String(bruto) },
        body: null,
      }
    }
    const { formato, chaves } = descreverFormato(body)
    return {
      sonda: {
        ...base, formato, chaves,
        // Amostra curta: o suficiente para ver o formato real de um item.
        amostra: amostraCurta(body),
      },
      body,
    }
  } catch (e) {
    return {
      sonda: {
        responde, caminho, status: null, ok: false,
        erro: `Falha de rede: ${e instanceof Error ? e.message : String(e)}`,
      },
      body: null,
    }
  }
}

type CampanhaCrua = { id: string; type: string; status?: string }

/**
 * As campanhas do corpo de `/seller-promotions/users/{id}`, uma por TIPO.
 *
 * Uma por tipo, e não a primeira de todas, porque a pergunta em aberto é
 * sobre subsídio — e subsídio, se existir, aparece onde o Mercado Livre
 * banca parte do desconto (campanha do marketplace), não numa oferta
 * relâmpago do próprio vendedor. Sondar três LIGHTNING seguidas responderia
 * a mesma coisa três vezes.
 */
function umaPorTipo(body: unknown, limite: number): CampanhaCrua[] {
  const lista = (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).results))
    ? ((body as Record<string, unknown>).results as unknown[])
    : Array.isArray(body) ? body : []
  const porTipo = new Map<string, CampanhaCrua>()
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue
    const c = bruto as Record<string, unknown>
    const id = typeof c.id === 'string' ? c.id : null
    const type = typeof c.type === 'string' ? c.type : null
    if (!id || !type || porTipo.has(type)) continue
    porTipo.set(type, { id, type, status: typeof c.status === 'string' ? c.status : undefined })
  }
  return [...porTipo.values()].slice(0, limite)
}

/** TODOS os tipos distintos, sem corte. O relatorio precisa dos dois: o que
 *  existe e o que foi aberto. Mostrar so a amostra faria uma lista truncada
 *  parecer a lista inteira — que e o defeito que esta sonda existe para nao
 *  cometer. */
function todosOsTipos(body: unknown): string[] {
  const lista = (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).results))
    ? ((body as Record<string, unknown>).results as unknown[])
    : Array.isArray(body) ? body : []
  const tipos = new Set<string>()
  for (const bruto of lista) {
    if (bruto && typeof bruto === 'object') {
      const tipo = (bruto as Record<string, unknown>).type
      if (typeof tipo === 'string') tipos.add(tipo)
    }
  }
  return [...tipos]
}

/** Primeiro item de uma lista, ou o próprio objeto — truncado. */
function amostraCurta(body: unknown): unknown {
  const alvo = Array.isArray(body)
    ? body[0]
    : (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).results))
      ? ((body as Record<string, unknown>).results as unknown[])[0]
      : body
  if (alvo === undefined) return null
  const texto = JSON.stringify(alvo)
  return texto && texto.length > 1500 ? `${texto.slice(0, 1500)}… (truncado)` : alvo
}

export async function GET() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: canais } = await sb.from('marketplace_canais')
    .select('id, nome, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('empresa_id', guarda.empresaId)
    .eq('plataforma', 'mercadolivre')
    .order('nome')

  if (!canais?.length) {
    return NextResponse.json({ ok: false, erro: 'Nenhum canal do Mercado Livre conectado.' }, { status: 400 })
  }

  const relatorio = []
  for (const row of canais) {
    const canal: MLChannel = {
      id: row.id, empresaId: row.empresa_id, sellerId: row.seller_id,
      accessToken: row.access_token, refreshToken: row.refresh_token, tokenExpiraEm: row.token_expira_em,
    }

    let token: string
    try {
      const valido = await refreshAccessTokenIfNeeded(sb, canal)
      token = valido.accessToken
    } catch (e) {
      relatorio.push({
        canal: row.nome,
        erro: `Não foi possível obter token válido: ${e instanceof Error ? e.message : String(e)}`,
        sondas: [],
      })
      continue
    }

    // Um anúncio real da conta, para a sonda por item. Sem ele a pergunta 3
    // (preço por item ou por variação?) fica sem como ser feita.
    const { data: anuncio } = await sb.from('marketplace_anuncios')
      .select('id_externo, titulo')
      .eq('canal_id', row.id).eq('status', 'ativo')
      .not('id_externo', 'is', null)
      .order('id_externo')
      .limit(1).maybeSingle()

    const sondas: Sonda[] = []

    sondas.push((await sondar(
      'O token funciona? (controle — se esta falhar, nenhuma outra vale)',
      '/users/me', token,
    )).sonda)

    const campanhas = await sondar(
      'P1/P2: o token alcança /seller-promotions e quais promotion_type aparecem',
      `/seller-promotions/users/${row.seller_id}?app_version=${APP_VERSION}`, token,
    )
    sondas.push(campanhas.sonda)

    // Medido em 30/08/2026: 404 nos dois canais. O caminho existia só nos
    // resumos de busca. Continua sondado de propósito — se um dia passar a
    // responder, é isso que avisa; e enquanto der 404, é a prova de que não
    // se implementa a partir de resumo.
    sondas.push((await sondar(
      'P2: itens que o ML convidou para campanha (candidates)',
      `/seller-promotions/candidates?app_version=${APP_VERSION}`, token,
    )).sonda)

    if (anuncio?.id_externo) {
      sondas.push((await sondar(
        `P3/P4: promoções do anúncio ${anuncio.id_externo} — por item ou por variação, e há subsídio?`,
        `/seller-promotions/items/${anuncio.id_externo}?app_version=${APP_VERSION}`, token,
      )).sonda)
    }

    // ── SEGUNDA RODADA ────────────────────────────────────────────────────
    //
    // Só existe porque a primeira funcionou: estes caminhos precisam de um id
    // de campanha real, e id de campanha não se inventa.
    const amostraCampanhas = umaPorTipo(campanhas.body, MAX_TIPOS)
    for (const c of amostraCampanhas) {
      const qs = `promotion_type=${encodeURIComponent(c.type)}&app_version=${APP_VERSION}`
      sondas.push((await sondar(
        `P4: a campanha ${c.id} (${c.type}) por inteiro — existe campo de subsídio?`,
        `/seller-promotions/promotions/${encodeURIComponent(c.id)}?${qs}`, token,
      )).sonda)
      sondas.push((await sondar(
        `P2/P4: itens dentro da campanha ${c.id} (${c.type})`,
        `/seller-promotions/promotions/${encodeURIComponent(c.id)}/items?${qs}`, token,
      )).sonda)
    }

    // P3: o anúncio da primeira rodada podia não ter variação — e sem
    // variação a pergunta "o preço promocional é por item ou por variação?"
    // não chega nem a ser feita.
    const { data: comVariacao } = await sb.from('marketplace_anuncios')
      .select('id_externo')
      .eq('canal_id', row.id).eq('status', 'ativo').eq('tem_variacao', true)
      .not('id_externo', 'is', null)
      .order('id_externo')
      .limit(1).maybeSingle()

    if (comVariacao?.id_externo) {
      sondas.push((await sondar(
        `P3: anúncio COM variação (${comVariacao.id_externo}) — o preço promocional desce até a variação?`,
        `/seller-promotions/items/${comVariacao.id_externo}?app_version=${APP_VERSION}`, token,
      )).sonda)
    }

    relatorio.push({
      canal: row.nome,
      sellerId: row.seller_id,
      anuncioSondado: anuncio?.id_externo ?? null,
      anuncioComVariacaoSondado: comVariacao?.id_externo ?? null,
      // P2 em duas linhas, e precisa das duas: o que a conta TEM, e o que a
      // sonda chegou a abrir. So a segunda faria uma amostra parecer o total.
      tiposDeCampanha: todosOsTipos(campanhas.body),
      tiposAbertos: amostraCampanhas.map(c => c.type),
      sondas,
    })
  }

  // O que a sonda NÃO responde continua dito em voz alta. Uma sonda que só
  // lista o que descobriu deixa o resto parecer respondido.
  const naoRespondido = [
    'P5 (webhook ou polling): não se descobre por GET — depende do painel de notificações do app.',
    'P6 (rate limit): só aparece se o ML mandar cabeçalho; veja `rateLimit` em cada sonda.',
    'Escrita (entrar/sair de campanha): fora do escopo desta rota, por decisão.',
    'P3 fica sem resposta se o canal não tiver nenhum anúncio ativo com variação — veja `anuncioComVariacaoSondado: null`.',
    'P4: ausência de campo de subsídio nas sondas abaixo é NÃO OBSERVADO, não "não existe". Só os tipos listados em `tiposDeCampanha` foram abertos.',
  ]

  return NextResponse.json({ ok: true, sondadoEm: new Date().toISOString(), relatorio, naoRespondido })
}
