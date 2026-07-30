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
