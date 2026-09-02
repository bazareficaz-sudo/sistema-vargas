import Anthropic from '@anthropic-ai/sdk'
import { obterSegredoProvedor } from '@/lib/ia/segredos'
import type { Consulta, ClienteSupabase } from '@/lib/ia/consultas/tipos'

// PERGUNTA COM CONSULTAS AO BANCO.
//
// O gateway normal manda UM prompt e recebe UMA resposta. Isso tem teto: o
// prompt carrega um retrato pre-calculado, e o modelo so responde o que
// alguem anteviu. Medido em 02/09/2026 — "teve venda do produto 24150
// ontem?" recebeu "nao tenho esse dado". Tinha: 2 vendas, 3 unidades,
// R$ 7,50. O que faltava era o modelo poder PEDIR.
//
// Aqui ele pede. Escolhe uma consulta do catalogo, o servidor executa, as
// linhas voltam, e o laco repete ate ele ter o suficiente para responder.
//
// O CATALOGO E FECHADO, e isso e o ponto. Ver `consultas/tipos.ts` para o
// porque de nao ser SQL livre.

const MAX_VOLTAS = 4

export type ResultadoComConsultas =
  | { ok: true; valor: unknown; voltas: number; consultasUsadas: string[]; tokensEntrada: number; tokensSaida: number }
  | { ok: false; motivo: string }

/**
 * Roda o laço de consultas e devolve o JSON final.
 *
 * `MAX_VOLTAS` limita custo e tempo. Ao estourar, o modelo é avisado de que
 * não haverá mais consultas e precisa responder com o que já tem — em vez de
 * ficar pedindo dados até o timeout e devolver nada.
 */
export async function perguntarComConsultas(params: {
  sb: ClienteSupabase
  empresaId: string
  prompt: string
  consultas: Consulta[]
  modelo: string
  maxTokens: number
  signal?: AbortSignal
}): Promise<ResultadoComConsultas> {
  const apiKey = await obterSegredoProvedor('anthropic')
  if (!apiKey) return { ok: false, motivo: 'chave_anthropic_ausente' }

  const client = new Anthropic({ apiKey })
  const ferramentas = params.consultas.map(c => ({
    name: c.nome,
    description: c.descricao,
    input_schema: c.parametros as Anthropic.Tool.InputSchema,
  }))
  const porNome = new Map(params.consultas.map(c => [c.nome, c]))

  const mensagens: Anthropic.MessageParam[] = [{ role: 'user', content: params.prompt }]
  const usadas: string[] = []
  let tokensEntrada = 0
  let tokensSaida = 0

  for (let volta = 1; volta <= MAX_VOLTAS; volta++) {
    const ultimaVolta = volta === MAX_VOLTAS
    const resposta = await client.messages.create({
      model: params.modelo,
      max_tokens: params.maxTokens,
      messages: mensagens,
      // Na última volta as ferramentas saem: com elas na mesa o modelo
      // continuaria pedindo dados e a resposta nunca sairia.
      ...(ultimaVolta ? {} : { tools: ferramentas }),
    }, { signal: params.signal })

    tokensEntrada += resposta.usage.input_tokens
    tokensSaida += resposta.usage.output_tokens

    const pedidos = resposta.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    if (pedidos.length === 0) {
      const texto = resposta.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text).join('')
      return { ok: true, valor: extrairJSON(texto), voltas: volta, consultasUsadas: usadas, tokensEntrada, tokensSaida }
    }

    mensagens.push({ role: 'assistant', content: resposta.content })

    const resultados: Anthropic.ToolResultBlockParam[] = []
    for (const pedido of pedidos) {
      const consulta = porNome.get(pedido.name)
      if (!consulta) {
        resultados.push({
          type: 'tool_result', tool_use_id: pedido.id, is_error: true,
          content: `Consulta "${pedido.name}" não existe. Use apenas as oferecidas.`,
        })
        continue
      }
      usadas.push(pedido.name)
      try {
        // O `empresaId` vem daqui, do servidor, e NUNCA dos argumentos do
        // modelo. É o que impede que uma pergunta bem escrita alcance o dado
        // de outra empresa.
        const r = await consulta.executar(
          params.sb, params.empresaId,
          (pedido.input ?? {}) as Record<string, unknown>,
        )
        resultados.push({
          type: 'tool_result', tool_use_id: pedido.id,
          content: JSON.stringify(r),
        })
      } catch (e) {
        // Falha de uma consulta não derruba a pergunta: o modelo é avisado e
        // pode tentar outra, ou dizer que não conseguiu.
        resultados.push({
          type: 'tool_result', tool_use_id: pedido.id, is_error: true,
          content: `Falha ao consultar: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
        })
      }
    }

    mensagens.push({ role: 'user', content: resultados })
  }

  return { ok: false, motivo: 'voltas_esgotadas' }
}

/** Extrai o JSON da resposta, tolerando cerca de crase. */
function extrairJSON(texto: string): unknown {
  const limpo = texto.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(limpo)
  } catch {
    const i = limpo.indexOf('{')
    const f = limpo.lastIndexOf('}')
    if (i >= 0 && f > i) {
      try { return JSON.parse(limpo.slice(i, f + 1)) } catch { /* cai fora */ }
    }
    return null
  }
}
