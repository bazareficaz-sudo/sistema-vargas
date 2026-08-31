import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ProvedorIA = 'herdar' | 'automatico' | 'anthropic' | 'openai' | 'desativado'

type ConfigIA = {
  habilitado: boolean
  provedor: ProvedorIA
  modelo: string | null
  limite_requisicoes_mes: number
  limite_tokens_mes: number
  max_tokens_resposta: number
  timeout_segundos: number
  fallback_automatico: boolean
  funcionalidades: string[]
}

type ExecucaoJSON = {
  valor: unknown
  provedor: 'anthropic' | 'openai'
  modelo: string
  tokensEntrada: number
  tokensSaida: number
}

type RespostaOpenAI = {
  output_text?: string
  output?: { content?: { type?: string; text?: string }[] }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

export type ResultadoGateway =
  | { ok: true; valor: unknown; provedor: 'anthropic' | 'openai'; modelo: string }
  | { ok: false; motivo: 'automatico' | 'desativado' | 'limite' | 'indisponivel'; fallbackAutomatico: boolean }

const configPadrao: ConfigIA = {
  habilitado: true,
  provedor: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'automatico',
  modelo: process.env.ANTHROPIC_API_KEY ? 'claude-haiku-4-5-20251001' : null,
  limite_requisicoes_mes: -1,
  limite_tokens_mes: -1,
  max_tokens_resposta: 1200,
  timeout_segundos: 25,
  fallback_automatico: true,
  funcionalidades: ['dashboard'],
}

const inicioMes = () => {
  const agora = new Date()
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString()
}

function extrairJSON(texto: string): unknown {
  const bloco = texto.match(/\{[\s\S]*\}/)?.[0]
  if (!bloco) throw new Error('resposta_sem_json')
  return JSON.parse(bloco)
}

async function carregarConfig(supabase: SupabaseClient, empresaId: string): Promise<ConfigIA> {
  const [globalRes, empresaRes] = await Promise.all([
    supabase.from('ia_saas_config').select('provedor_padrao, modelo_padrao, limite_requisicoes_padrao, limite_tokens_padrao, max_tokens_resposta, timeout_segundos, fallback_automatico').eq('id', true).maybeSingle(),
    supabase.from('ia_empresa_config')
    .select('habilitado, provedor, modelo, limite_requisicoes_mes, limite_tokens_mes, max_tokens_resposta, timeout_segundos, fallback_automatico, funcionalidades')
    .eq('empresa_id', empresaId).maybeSingle(),
  ])
  // Compatibilidade antes da migração chegar ao banco.
  if (globalRes.error && empresaRes.error) return configPadrao
  const global = globalRes.data ? {
    ...configPadrao,
    provedor: globalRes.data.provedor_padrao as ProvedorIA,
    modelo: globalRes.data.modelo_padrao,
    limite_requisicoes_mes: globalRes.data.limite_requisicoes_padrao,
    limite_tokens_mes: globalRes.data.limite_tokens_padrao,
    max_tokens_resposta: globalRes.data.max_tokens_resposta,
    timeout_segundos: globalRes.data.timeout_segundos,
    fallback_automatico: globalRes.data.fallback_automatico,
  } : configPadrao
  if (!empresaRes.data) return global
  const empresa = empresaRes.data as ConfigIA
  return empresa.provedor === 'herdar' ? { ...empresa, provedor: global.provedor, modelo: global.modelo } : empresa
}

async function dentroDoLimite(supabase: SupabaseClient, empresaId: string, config: ConfigIA) {
  if (config.limite_requisicoes_mes === -1 && config.limite_tokens_mes === -1) return true
  const { data, count, error } = await supabase.from('ia_consumo')
    .select('tokens_total', { count: 'exact' })
    .eq('empresa_id', empresaId).eq('status', 'sucesso').gte('created_at', inicioMes())
  if (error) return true // telemetria nunca derruba a operação existente
  const tokens = (data ?? []).reduce((total, linha) => total + Number(linha.tokens_total ?? 0), 0)
  return (config.limite_requisicoes_mes === -1 || (count ?? 0) < config.limite_requisicoes_mes)
    && (config.limite_tokens_mes === -1 || tokens < config.limite_tokens_mes)
}

async function executarAnthropic(prompt: string, config: ConfigIA, signal: AbortSignal): Promise<ExecucaoJSON> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('chave_anthropic_ausente')
  const modelo = config.modelo || 'claude-haiku-4-5-20251001'
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const resposta = await client.messages.create({
    model: modelo,
    max_tokens: config.max_tokens_resposta,
    messages: [{ role: 'user', content: prompt }],
  }, { signal })
  const texto = resposta.content.filter(bloco => bloco.type === 'text').map(bloco => bloco.text).join('')
  return {
    valor: extrairJSON(texto), provedor: 'anthropic', modelo,
    tokensEntrada: resposta.usage.input_tokens, tokensSaida: resposta.usage.output_tokens,
  }
}

async function executarOpenAI(prompt: string, config: ConfigIA, signal: AbortSignal): Promise<ExecucaoJSON> {
  if (!process.env.OPENAI_API_KEY) throw new Error('chave_openai_ausente')
  const modelo = config.modelo || 'gpt-5.6-luna'
  const resposta = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, input: prompt, max_output_tokens: config.max_tokens_resposta, store: false }),
  })
  const data = await resposta.json() as RespostaOpenAI
  if (!resposta.ok) throw new Error(`openai_${resposta.status}`)
  const texto = typeof data.output_text === 'string'
    ? data.output_text
    : (data.output ?? []).flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text ?? '').join('')
  return {
    valor: extrairJSON(texto), provedor: 'openai', modelo,
    tokensEntrada: Number(data.usage?.input_tokens ?? 0), tokensSaida: Number(data.usage?.output_tokens ?? 0),
  }
}

async function registrar(supabase: SupabaseClient, dados: Record<string, unknown>) {
  try { await supabase.from('ia_consumo').insert(dados) } catch { /* telemetria não interrompe a operação */ }
}

export async function perguntarJSONComGateway(params: {
  supabase: SupabaseClient
  empresaId: string
  usuarioId: string
  funcionalidade: string
  prompt: string
}): Promise<ResultadoGateway> {
  const config = await carregarConfig(params.supabase, params.empresaId)
  if (!config.habilitado || config.provedor === 'desativado') return { ok: false, motivo: 'desativado', fallbackAutomatico: config.fallback_automatico }
  if (config.provedor === 'automatico') return { ok: false, motivo: 'automatico', fallbackAutomatico: true }
  if (!config.funcionalidades.includes(params.funcionalidade)) return { ok: false, motivo: 'desativado', fallbackAutomatico: config.fallback_automatico }
  if (!await dentroDoLimite(params.supabase, params.empresaId, config)) return { ok: false, motivo: 'limite', fallbackAutomatico: config.fallback_automatico }

  const inicio = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeout_segundos * 1000)
  try {
    const execucao = config.provedor === 'openai'
      ? await executarOpenAI(params.prompt, config, controller.signal)
      : await executarAnthropic(params.prompt, config, controller.signal)
    await registrar(params.supabase, {
      empresa_id: params.empresaId, usuario_id: params.usuarioId, funcionalidade: params.funcionalidade,
      provedor: execucao.provedor, modelo: execucao.modelo, status: 'sucesso',
      tokens_entrada: execucao.tokensEntrada, tokens_saida: execucao.tokensSaida, latencia_ms: Date.now() - inicio,
    })
    return { ok: true, valor: execucao.valor, provedor: execucao.provedor, modelo: execucao.modelo }
  } catch (erro) {
    await registrar(params.supabase, {
      empresa_id: params.empresaId, usuario_id: params.usuarioId, funcionalidade: params.funcionalidade,
      provedor: config.provedor, modelo: config.modelo || 'padrao', status: 'erro', latencia_ms: Date.now() - inicio,
      categoria_erro: erro instanceof Error ? erro.message.slice(0, 120) : 'erro_desconhecido',
    })
    return { ok: false, motivo: 'indisponivel', fallbackAutomatico: config.fallback_automatico }
  } finally {
    clearTimeout(timeout)
  }
}
