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

async function sondar(responde: string, caminho: string, token: string): Promise<Sonda> {
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
      return { ...base, erro: typeof bruto === 'string' ? bruto.slice(0, 500) : String(bruto) }
    }
    const { formato, chaves } = descreverFormato(body)
    return {
      ...base, formato, chaves,
      // Amostra curta: o suficiente para ver o formato real de um item.
      amostra: amostraCurta(body),
    }
  } catch (e) {
    return {
      responde, caminho, status: null, ok: false,
      erro: `Falha de rede: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
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

    sondas.push(await sondar(
      'O token funciona? (controle — se esta falhar, nenhuma outra vale)',
      '/users/me', token,
    ))

    sondas.push(await sondar(
      'P1/P2: o token alcança /seller-promotions e quais promotion_type aparecem',
      `/seller-promotions/users/${row.seller_id}?app_version=${APP_VERSION}`, token,
    ))

    sondas.push(await sondar(
      'P2: itens que o ML convidou para campanha (candidates)',
      `/seller-promotions/candidates?app_version=${APP_VERSION}`, token,
    ))

    if (anuncio?.id_externo) {
      sondas.push(await sondar(
        `P3/P4: promoções do anúncio ${anuncio.id_externo} — por item ou por variação, e há subsídio?`,
        `/seller-promotions/items/${anuncio.id_externo}?app_version=${APP_VERSION}`, token,
      ))
    }

    relatorio.push({
      canal: row.nome,
      sellerId: row.seller_id,
      anuncioSondado: anuncio?.id_externo ?? null,
      sondas,
    })
  }

  // O que a sonda NÃO responde continua dito em voz alta. Uma sonda que só
  // lista o que descobriu deixa o resto parecer respondido.
  const naoRespondido = [
    'P5 (webhook ou polling): não se descobre por GET — depende do painel de notificações do app.',
    'P6 (rate limit): só aparece se o ML mandar cabeçalho; veja `rateLimit` em cada sonda.',
    'Escrita (entrar/sair de campanha): fora do escopo desta rota, por decisão.',
  ]

  return NextResponse.json({ ok: true, sondadoEm: new Date().toISOString(), relatorio, naoRespondido })
}
