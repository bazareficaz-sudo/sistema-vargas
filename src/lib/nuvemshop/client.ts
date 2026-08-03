import { NuvemshopApiError, type NuvemshopChannel, type NuvemshopCredentials } from './types'
import { createAdminClient } from '@/lib/supabase/admin'

// A doc oficial usa `/v1/{store_id}` nos exemplos e no template Node oficial
// deles; a página nova de introdução mostra uma versão datada
// (`/2025-03/{store_id}`). As duas respondem — `v1` é a que aparece em todo
// exemplo executável, então é a que uso aqui.
const API_BASE = 'https://api.nuvemshop.com.br/v1'

// O User-Agent é OBRIGATÓRIO na Nuvemshop: sem ele a API responde 400, não
// importa o token. Tem que identificar a aplicação e um contato.
const USER_AGENT = 'Sistema Vargas (contato@sistemavargas.com.br)'

// Limite: balde de 40 requisições que esvazia a 2 por segundo. 550ms entre
// chamadas fica abaixo do ritmo de reposição e nunca esgota o balde num
// catálogo grande.
export const THROTTLE_MS = 550
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// As credenciais do app são DA PLATAFORMA, não do lojista: valem para todas
// as lojas conectadas. Mesma decisão já tomada no Mercado Livre — leitura
// sempre com a chave de serviço, tabela fechada para sessão de usuário.
export async function getIntegracaoCredentials(): Promise<NuvemshopCredentials> {
  const { data: integracao } = await createAdminClient()
    .from('sistema_integracoes')
    .select('app_id, app_secret')
    .eq('plataforma', 'nuvemshop')
    .single()

  if (!integracao?.app_id || !integracao?.app_secret) {
    throw new NuvemshopApiError('Credenciais da Nuvemshop não configuradas em Configurações → Integrações.')
  }
  return { appId: integracao.app_id, appSecret: integracao.app_secret }
}

// A Nuvemshop trocou o nome do cabeçalho de autenticação entre versões da
// documentação: os exemplos executáveis e uma nota explícita dizem
// `Authentication: bearer`, a página nova de introdução diz
// `Authorization: Bearer`. Mando os dois — um a mais é ignorado, e assim a
// integração não quebra dependendo de qual versão a conta caiu.
function cabecalhos(accessToken: string, comCorpo = false): Record<string, string> {
  const h: Record<string, string> = {
    Authentication: `bearer ${accessToken}`,
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': USER_AGENT,
  }
  if (comCorpo) h['Content-Type'] = 'application/json; charset=utf-8'
  return h
}

async function parseResposta(res: Response, path: string) {
  const texto = await res.text()
  const body = texto ? (() => { try { return JSON.parse(texto) } catch { return texto } })() : null

  if (!res.ok) {
    // Erro da Nuvemshop costuma vir como { "description": "..." } ou como um
    // mapa de campo -> lista de problemas. Sem desdobrar isso, o operador vê
    // só o código HTTP.
    let detalhe: string | null = null
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>
      if (typeof b.description === 'string') detalhe = b.description
      else if (typeof b.error === 'string') detalhe = b.error
      else {
        const partes = Object.entries(b)
          .map(([campo, val]) => `${campo}: ${Array.isArray(val) ? val.join(', ') : String(val)}`)
        if (partes.length > 0) detalhe = partes.join(' · ')
      }
    } else if (typeof body === 'string' && body.trim()) {
      detalhe = body.slice(0, 300)
    }

    if (res.status === 401) {
      throw new NuvemshopApiError(
        'Token da Nuvemshop recusado — a loja pode ter desinstalado o aplicativo. Reconecte em Marketplaces.',
        401, body)
    }
    if (res.status === 429) {
      throw new NuvemshopApiError(
        'Limite de requisições da Nuvemshop atingido. Tente novamente em alguns segundos.',
        429, body)
    }

    throw new NuvemshopApiError(
      detalhe ? `Nuvemshop em ${path}: ${detalhe}` : `Erro Nuvemshop em ${path} (status ${res.status})`,
      res.status, body)
  }

  return body
}

function montarUrl(storeId: string, path: string, params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  )
  return `${API_BASE}/${storeId}${path}${qs.toString() ? `?${qs.toString()}` : ''}`
}

/**
 * GET que também devolve o total de registros. A Nuvemshop informa o total em
 * `x-total-count`, não no corpo — quem pagina precisa desse número para saber
 * quando parar, e ele se perde se a função devolver só o JSON.
 */
export async function nuvemshopGetComTotal(
  canal: NuvemshopChannel, path: string, params: Record<string, string | number> = {},
): Promise<{ dados: any; total: number | null }> {
  const res = await fetch(montarUrl(canal.storeId, path, params), { headers: cabecalhos(canal.accessToken) })
  const dados = await parseResposta(res, path)
  const bruto = res.headers.get('x-total-count')
  const total = bruto != null && bruto !== '' ? Number(bruto) : null
  return { dados, total: Number.isFinite(total as number) ? (total as number) : null }
}

export async function nuvemshopGet(
  canal: NuvemshopChannel, path: string, params: Record<string, string | number> = {},
): Promise<any> {
  const { dados } = await nuvemshopGetComTotal(canal, path, params)
  return dados
}

export async function nuvemshopPost(canal: NuvemshopChannel, path: string, body: unknown): Promise<any> {
  const res = await fetch(montarUrl(canal.storeId, path), {
    method: 'POST', headers: cabecalhos(canal.accessToken, true), body: JSON.stringify(body),
  })
  return parseResposta(res, path)
}

export async function nuvemshopPut(canal: NuvemshopChannel, path: string, body: unknown): Promise<any> {
  const res = await fetch(montarUrl(canal.storeId, path), {
    method: 'PUT', headers: cabecalhos(canal.accessToken, true), body: JSON.stringify(body),
  })
  return parseResposta(res, path)
}

/**
 * Troca o código de autorização pelo token de acesso.
 *
 * Dois pontos que diferem de Shopee e Mercado Livre e que estão na doc:
 * os dados vão como JSON no corpo (não como parâmetros na URL), e o endereço
 * de troca NÃO leva store_id — é o único que fica fora do prefixo da loja.
 */
export async function trocarCodigoPorToken(code: string): Promise<{ accessToken: string; storeId: string; scope: string }> {
  const { appId, appSecret } = await getIntegracaoCredentials()

  const res = await fetch('https://www.tiendanube.com/apps/authorize/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      code,
    }),
  })

  const data = await parseResposta(res, '/apps/authorize/token')

  // A loja vem como `user_id` (nome herdado), e é ele que entra na URL de
  // toda chamada seguinte.
  const storeId = data?.user_id != null ? String(data.user_id) : null
  if (!data?.access_token || !storeId) {
    throw new NuvemshopApiError('A Nuvemshop não devolveu token e identificação da loja.', undefined, data)
  }

  return { accessToken: data.access_token, storeId, scope: data.scope ?? '' }
}
