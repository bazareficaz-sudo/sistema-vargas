import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { refreshAccessTokenIfNeeded } from '@/lib/shopee/client'
import { getIntegracaoCredentials } from '@/lib/shopee/client'
import { listarDescontos } from '@/lib/shopee/discount'
import type { ShopeeChannel } from '@/lib/shopee/types'
import { createHmac } from 'crypto'

// SONDA DE CAMPANHA DA SHOPEE — SOMENTE LEITURA.
//
// Todas as chamadas daqui sao GET. Nenhuma cria campanha, acrescenta item ou
// altera preco. Se um dia a escrita entrar, ela nao entra NESTE arquivo.
//
// POR QUE EXISTE. O gestor perguntou como acrescentar um produto numa
// campanha ja existente. A resposta honesta e que nao sabemos: nenhuma
// chamada de escrita de desconto existe no repositorio, e duas coisas do
// contrato so se descobrem chamando —
//
//   `add_discount_item` aceita item em campanha JA EM ANDAMENTO, ou so em
//   `upcoming`? A campanha real desta loja ("Bota Fora") esta ongoing ate
//   31/10, e essa e exatamente a pergunta que decide se o recurso serve.
//
//   Qual a forma do item com variacao? A leitura ja mostra que o preco mora
//   em `model_list`, mas a forma que a ESCRITA espera pode diferir.
//
// Escrever o cliente a partir de resumo de documentacao repetiria o erro que
// a publicacao de anuncio na Shopee ja custou aqui: contrato descoberto erro
// a erro, contra producao ("condition is required", "ValueId is required").
//
// POR QUE NAO USA `shopeeGet`. Ele lanca `ShopeeApiError` em qualquer
// resposta com `error` — e perde o codigo, que aqui e a resposta inteira. Uma
// sonda precisa distinguir "endpoint nao existe" de "existe e recusou o
// parametro" de "existe e falta permissao". Colapsar os tres em "erro" seria
// trocar a medicao por um palpite.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const API_BASE = 'https://partner.shopeemobile.com'

type Sonda = {
  pergunta: string
  caminho: string
  parametros: Record<string, unknown>
  /** `error` cru da Shopee: '' quando deu certo. */
  erro: string
  mensagem: string
  /** Um pedaço da resposta, cortado — a sonda não é dump. */
  amostra: unknown
}

/** Recorta objeto grande: a sonda mostra a FORMA, não o conteúdo inteiro. */
function amostrar(valor: unknown, profundidade = 0): unknown {
  if (valor === null || valor === undefined) return valor
  if (Array.isArray(valor)) {
    return valor.slice(0, 2).map(v => amostrar(v, profundidade + 1))
      .concat(valor.length > 2 ? [`… mais ${valor.length - 2}`] : [])
  }
  if (typeof valor === 'object') {
    if (profundidade > 3) return '{…}'
    const saida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>).slice(0, 25)) {
      saida[k] = amostrar(v, profundidade + 1)
    }
    return saida
  }
  return valor
}

export async function GET(req: Request) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const canalId = new URL(req.url).searchParams.get('canalId')
  if (!canalId) return NextResponse.json({ ok: false, erro: 'Informe o canal.' }, { status: 400 })

  const { data: row } = await sb.from('marketplace_canais')
    .select('id, nome, empresa_id, seller_id, access_token, refresh_token, token_expira_em')
    .eq('id', canalId).eq('empresa_id', guarda.empresaId).eq('plataforma', 'shopee').maybeSingle()
  if (!row?.access_token) {
    return NextResponse.json({ ok: false, erro: 'Canal Shopee não encontrado ou não conectado.' }, { status: 404 })
  }

  let canal: ShopeeChannel = {
    id: row.id, empresaId: row.empresa_id, sellerId: row.seller_id,
    accessToken: row.access_token, refreshToken: row.refresh_token, tokenExpiraEm: row.token_expira_em,
  }
  canal = await refreshAccessTokenIfNeeded(sb, canal)
  const { partnerId, partnerKey } = await getIntegracaoCredentials(sb)

  const sondas: Sonda[] = []

  async function sondar(pergunta: string, caminho: string, params: Record<string, string | number>) {
    const ts = Math.floor(Date.now() / 1000)
    const base = `${partnerId}${caminho}${ts}${canal.accessToken}${canal.sellerId}`
    const sign = createHmac('sha256', partnerKey).update(base).digest('hex')
    const qs = new URLSearchParams({
      partner_id: String(partnerId), timestamp: String(ts), sign,
      access_token: canal.accessToken, shop_id: String(canal.sellerId),
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    })
    try {
      const res = await fetch(`${API_BASE}${caminho}?${qs.toString()}`)
      const body = await res.json().catch(() => null)
      sondas.push({
        pergunta, caminho, parametros: params,
        erro: String(body?.error ?? ''),
        mensagem: String(body?.message ?? ''),
        amostra: amostrar(body?.response ?? body),
      })
    } catch (e) {
      sondas.push({
        pergunta, caminho, parametros: params,
        erro: 'falha_de_rede', mensagem: e instanceof Error ? e.message : String(e), amostra: null,
      })
    }
  }

  // P1: quais campanhas existem, e em que situação. A escrita depende disso —
  // acrescentar item numa `ongoing` pode não ser permitido.
  const campanhas = await listarDescontos({ sb, canal }, 'all').catch(() => [])

  // `listarDescontos` JA TRADUZ o status: devolve 'ativa'/'agendada'/
  // 'encerrada', nao o 'ongoing'/'upcoming'/'expired' cru da Shopee. A
  // primeira versao desta sonda comparava com o nome cru, entao P2 e P3
  // nunca dispararam — a resposta saiu so com P4/P5/P6 e o erro passou
  // despercebido porque as tres que importavam responderam.
  //
  // Comparar pelo `bruto.status` seria a outra saida, e e pior: amarraria a
  // sonda ao formato da API em vez do vocabulario do sistema.
  const ongoing = campanhas.find(c => c.status === 'ativa')
  const upcoming = campanhas.find(c => c.status === 'programada')

  // P2: a forma COMPLETA de uma campanha em andamento, com os itens. É o
  // molde do que a escrita vai ter de montar.
  if (ongoing) {
    await sondar(
      `P2: forma completa da campanha em andamento "${ongoing.nome}" — quais campos o item tem, e onde mora o preço nas variações`,
      '/api/v2/discount/get_discount',
      { discount_id: Number(ongoing.discountId), page_no: 1, page_size: 20 },
    )
  }
  if (upcoming) {
    await sondar(
      `P3: a mesma leitura numa campanha AINDA NÃO iniciada ("${upcoming.nome}") — a forma muda?`,
      '/api/v2/discount/get_discount',
      { discount_id: Number(upcoming.discountId), page_no: 1, page_size: 20 },
    )
  }

  // P4: o endpoint de acrescentar item EXISTE e o que ele responde a uma
  // chamada malformada? Chamado por GET DE PROPÓSITO: `add_discount_item` é
  // POST, então um GET não pode criar nada. O que interessa é o código de
  // erro — ele diz se o caminho existe (parâmetro faltando) ou não (404 /
  // "path not found"), sem tocar em campanha nenhuma.
  await sondar(
    'P4: o caminho /discount/add_discount_item existe? (chamado por GET, que NÃO acrescenta nada — só revela se o endpoint é reconhecido)',
    '/api/v2/discount/add_discount_item', {},
  )
  await sondar(
    'P5: e /discount/update_discount_item? (mesma coisa: GET, sem efeito)',
    '/api/v2/discount/update_discount_item', {},
  )
  await sondar(
    'P6: e /discount/delete_discount_item?',
    '/api/v2/discount/delete_discount_item', {},
  )

  return NextResponse.json({
    ok: true,
    canal: row.nome,
    campanhas: campanhas.map(c => ({
      id: c.discountId, nome: c.nome, status: c.status,
      inicio: c.inicio, fim: c.fim,
    })),
    sondas,
    // O que esta sonda NÃO responde continua dito em voz alta. Uma sonda que
    // só lista o que descobriu deixa o resto parecer respondido.
    naoRespondido: [
      'Se `add_discount_item` ACEITA item em campanha ongoing: só um POST real responderia, e esta sonda não escreve. O erro devolvido em P4 pode indicar o caminho, não a regra de negócio.',
      'O limite de itens por chamada: não aparece em leitura.',
      'Se o preço promocional de item COM variação vai por modelo na escrita como vai na leitura — a forma do POST pode diferir da do GET.',
    ],
  })
}
