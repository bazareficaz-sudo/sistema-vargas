// O RELATÓRIO DE LIBERAÇÕES DO MERCADO PAGO, SÓ LEITURA.
//
// ── A TRAVA, E POR QUE ELA É DE CÓDIGO ───────────────────────────────────
//
// O token do Mercado Pago é a chave da conta de dinheiro. Com ele dá para
// estornar pagamento, criar saque e transferir saldo. Nada disso tem a ver
// com conciliar extrato, e a diferença entre "eu não vou chamar esses
// endpoints" e "este módulo não consegue chamar esses endpoints" é a única
// que continua valendo depois que alguém mexer no arquivo.
//
// Então existe uma LISTA DE CAMINHOS PERMITIDOS, e `chamar` recusa qualquer
// outro antes de montar a requisição. Acrescentar `/v1/payments/:id/refund`
// aqui exigiria editar a lista, que é um ato visível no diff.
//
// O único POST permitido é o que MANDA GERAR O ARQUIVO. Ele não move dinheiro:
// produz um relatório. Os outros dois passos são GET.
//
// ── O FLUXO É ASSÍNCRONO, EM TRÊS PASSOS ─────────────────────────────────
//
//   1. POST /v1/account/release_report  {begin_date, end_date}  -> 202
//   2. GET  /v1/account/release_report/list                     -> file_name
//   3. GET  /v1/account/release_report/:file_name               -> CSV
//
// A documentação oficial é inconsistente em dois pontos, e isto é tratado em
// vez de ignorado: ela mostra o passo 2 ora como GET com `access_token` na
// query, ora como POST com Bearer; e não diz em qual campo vem o nome do
// arquivo. `nomeDoArquivo` abaixo procura nos campos plausíveis e, se não
// achar, devolve erro dizendo quais campos chegaram — em vez de adivinhar.

const BASE = 'https://api.mercadopago.com'

/**
 * Tudo que este módulo pode chamar. Qualquer caminho fora daqui é recusado
 * antes de a requisição existir.
 *
 * `^` e `$` em todas: sem as âncoras, `/v1/account/release_report` casaria
 * com `/v1/account/release_report/../../payments/123/refund`.
 */
const CAMINHOS_PERMITIDOS: { metodo: 'GET' | 'POST'; padrao: RegExp }[] = [
  { metodo: 'POST', padrao: /^\/v1\/account\/release_report$/ },
  { metodo: 'GET',  padrao: /^\/v1\/account\/release_report\/list$/ },
  { metodo: 'GET',  padrao: /^\/v1\/account\/release_report\/config$/ },
  // O nome do arquivo que o próprio Mercado Pago devolveu. Sem barra, ponto
  // duplo ou query: só nome de arquivo.
  { metodo: 'GET',  padrao: /^\/v1\/account\/release_report\/[A-Za-z0-9._-]+$/ },
]

export class RecusadoPelaTrava extends Error {}

export function permitido(metodo: string, caminho: string): boolean {
  if (caminho.includes('..')) return false
  return CAMINHOS_PERMITIDOS.some(p => p.metodo === metodo && p.padrao.test(caminho))
}

export type Buscador = (url: string, init?: any) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

export type Opcoes = {
  token: string
  buscar?: Buscador
}

async function chamar(
  metodo: 'GET' | 'POST',
  caminho: string,
  { token, buscar }: Opcoes,
  corpo?: unknown,
): Promise<{ status: number; texto: string }> {
  if (!permitido(metodo, caminho)) {
    throw new RecusadoPelaTrava(
      `${metodo} ${caminho} nao esta na lista de caminhos permitidos. ` +
      'Este modulo le relatorio e nada mais: nao movimenta dinheiro no Mercado Pago.',
    )
  }
  if (!token) throw new Error('Token do Mercado Pago ausente no servidor.')

  const f = buscar ?? (globalThis.fetch as unknown as Buscador)
  const r = await f(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  })

  const texto = await r.text()
  return { status: r.status, texto }
}

/** Passo 1: manda gerar. `202` é sucesso — o arquivo vem depois. */
export async function pedirRelatorio(
  de: string, ate: string, opcoes: Opcoes,
): Promise<{ aceito: boolean; status: number; mensagem: string }> {
  const { status, texto } = await chamar('POST', '/v1/account/release_report', opcoes, {
    begin_date: `${de}T00:00:00Z`,
    end_date: `${ate}T23:59:59Z`,
  })

  // 203 não é erro de rede nem sucesso: é o Mercado Pago dizendo que o
  // relatório NÃO foi criado e indicando outras datas. Tratar como sucesso
  // deixaria o importador esperando para sempre um arquivo que não vem.
  if (status === 203) {
    return { aceito: false, status, mensagem: `O Mercado Pago recusou o periodo e sugeriu outro: ${resumir(texto)}` }
  }
  if (status === 202 || status === 200 || status === 201) {
    return { aceito: true, status, mensagem: 'Relatorio solicitado. O arquivo fica pronto em alguns minutos.' }
  }
  return { aceito: false, status, mensagem: `O Mercado Pago respondeu ${status}: ${resumir(texto)}` }
}

export type RelatorioListado = {
  nomeArquivo: string
  status: string | null
  de: string | null
  ate: string | null
}

/** Passo 2: acha os arquivos prontos. */
export async function listarRelatorios(opcoes: Opcoes): Promise<RelatorioListado[]> {
  const { status, texto } = await chamar('GET', '/v1/account/release_report/list', opcoes)
  if (status !== 200) throw new Error(`Nao foi possivel listar os relatorios (${status}): ${resumir(texto)}`)

  let json: unknown
  try { json = JSON.parse(texto) } catch { throw new Error('A lista de relatorios nao veio em JSON.') }

  const itens = Array.isArray(json)
    ? json
    : Array.isArray((json as any)?.results) ? (json as any).results : []

  return itens.map((i: any) => ({
    nomeArquivo: nomeDoArquivo(i),
    status: i?.status ?? i?.state ?? null,
    de: i?.begin_date ?? i?.date_from ?? null,
    ate: i?.end_date ?? i?.date_to ?? null,
  })).filter((r: RelatorioListado) => r.nomeArquivo !== '')
}

/**
 * Onde está o nome do arquivo.
 *
 * A documentação não diz em qual campo ele vem, então procuramos nos nomes
 * plausíveis. Chutar o campo errado faria o passo 3 pedir um arquivo
 * inexistente e o importador culpar o Mercado Pago por um erro nosso.
 */
export function nomeDoArquivo(item: any): string {
  for (const campo of ['file_name', 'fileName', 'name', 'report_id', 'id']) {
    const v = item?.[campo]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return ''
}

/** Passo 3: baixa o CSV. */
export async function baixarRelatorio(nomeArquivo: string, opcoes: Opcoes): Promise<string> {
  // O nome vem da resposta do Mercado Pago, mas confiar nele sem conferir é
  // como um caminho `../../payments/x/refund` entraria na URL.
  if (!/^[A-Za-z0-9._-]+$/.test(nomeArquivo)) {
    throw new RecusadoPelaTrava(`Nome de arquivo invalido: ${nomeArquivo}`)
  }
  const { status, texto } = await chamar(
    'GET', `/v1/account/release_report/${nomeArquivo}`, opcoes)
  if (status !== 200) throw new Error(`Nao foi possivel baixar ${nomeArquivo} (${status}): ${resumir(texto)}`)
  return texto
}

/**
 * Resumo da resposta para mensagem de erro.
 *
 * Corta em 300 caracteres e, acima de tudo, NUNCA deixa passar o que pareça
 * credencial: mensagem de erro vai para log, e log é lido por gente.
 */
export function resumir(texto: string): string {
  return String(texto ?? '')
    .replace(/(APP_USR|TEST)-[A-Za-z0-9_-]+/g, '[token omitido]')
    .replace(/"?access_token"?\s*[:=]\s*"?[A-Za-z0-9._-]+"?/gi, 'access_token=[omitido]')
    .slice(0, 300)
}

/** O token, do ambiente do servidor. Nunca do navegador, nunca do terminal. */
export function tokenDoAmbiente(): string {
  return process.env.MERCADO_PAGO_ACCESS_TOKEN ?? ''
}
