import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada — peça pro administrador cadastrar essa variável de ambiente.')
    client = new Anthropic({ apiKey })
  }
  return client
}

const MODELO = 'claude-haiku-4-5-20251001'

// Modelo mais forte, pra pergunta que exige memória factual de tabela oficial
// (NCM/TIPI/CEST). Medido contra o catálogo real: pra "TORNEIRA PARA PIA
// COZINHA PAREDE", o Haiku devolveu NCM 73071100 (acessório de tubo de ferro)
// e o Sonnet devolveu 84818099 — a família certa, que é a já cadastrada.
// Como NCM errado faz a SEFAZ rejeitar a NFC-e, vale o custo maior.
export const MODELO_FORTE = 'claude-sonnet-5'

// Pede uma resposta em JSON pra IA e faz o parse. A IA às vezes envolve o
// JSON em ```json ... ``` mesmo quando instruída a não fazer — por isso
// extrai o primeiro bloco {...} da resposta em vez de dar JSON.parse direto.
// max_tokens precisa cobrir o raciocínio do modelo ANTES do JSON — medido:
// com 1500 o Sonnet gastava a cota inteira pensando numa classificação fiscal
// difícil e devolvia zero bloco de texto, caindo no erro "não retornou um
// JSON válido". Por isso o modelo forte pede uma folga maior.
export async function perguntarJSON(prompt: string, modelo: string = MODELO): Promise<any> {
  const resp = await getClient().messages.create({
    model: modelo,
    max_tokens: modelo === MODELO_FORTE ? 6000 : 1500,
    messages: [{ role: 'user', content: prompt }],
  })
  const texto = resp.content.filter(b => b.type === 'text').map(b => (b as any).text).join('')
  const match = texto.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('A IA não retornou um JSON válido: ' + texto.slice(0, 200))
  return JSON.parse(match[0])
}

/**
 * Mesma coisa, olhando IMAGENS.
 *
 * O modelo lê imagem, não desenha: não existe API da Anthropic que gere ou
 * edite foto. O que dá para fazer — e é o que esta função serve — é conferir
 * imagem que já existe.
 *
 * As imagens vão como BYTES, não como endereço. A API aceita as duas formas,
 * mas na de endereço quem baixa é a Anthropic — e a CDN do Mercado Livre
 * recusa esse download, derrubando a chamada inteira (medido). Quem baixa e
 * prepara é `src/lib/imagens/paraVisao.ts`.
 *
 * Cada imagem entra rotulada ("Imagem 1"), senão não há como o modelo devolver
 * um veredito por imagem que a gente consiga casar de volta com a lista.
 */
export async function perguntarJSONComImagens(
  prompt: string,
  imagens: { base64: string; mediaType: string }[],
  modelo: string = MODELO,
): Promise<any> {
  if (imagens.length === 0) throw new Error('Nenhuma imagem para analisar.')

  const conteudo: any[] = []
  imagens.forEach((img, i) => {
    conteudo.push({ type: 'text', text: `Imagem ${i + 1}:` })
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })
  })
  conteudo.push({ type: 'text', text: prompt })

  const resp = await getClient().messages.create({
    model: modelo,
    max_tokens: modelo === MODELO_FORTE ? 6000 : 2000,
    messages: [{ role: 'user', content: conteudo }],
  })
  const texto = resp.content.filter(b => b.type === 'text').map(b => (b as any).text).join('')
  const match = texto.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('A IA não retornou um JSON válido: ' + texto.slice(0, 200))
  return JSON.parse(match[0])
}
