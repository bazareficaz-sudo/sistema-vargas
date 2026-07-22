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

// Pede uma resposta em JSON pra IA e faz o parse. A IA às vezes envolve o
// JSON em ```json ... ``` mesmo quando instruída a não fazer — por isso
// extrai o primeiro bloco {...} da resposta em vez de dar JSON.parse direto.
export async function perguntarJSON(prompt: string): Promise<any> {
  const resp = await getClient().messages.create({
    model: MODELO,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })
  const texto = resp.content.filter(b => b.type === 'text').map(b => (b as any).text).join('')
  const match = texto.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('A IA não retornou um JSON válido: ' + texto.slice(0, 200))
  return JSON.parse(match[0])
}
