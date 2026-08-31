import { createClient } from '@/lib/supabase/server'
import IAAdminClient, { type EmpresaIA, type GlobalIA } from '@/components/saas-admin/IAAdminClient'

export const dynamic = 'force-dynamic'

export default async function IAAdminPage() {
  const supabase = await createClient()
  const mesInicio = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
  const [{ data: empresas }, globalRes, configsRes, consumoRes] = await Promise.all([
    supabase.from('empresas').select('id, nome').order('nome').limit(500),
    supabase.from('ia_saas_config').select('*').eq('id', true).maybeSingle(),
    supabase.from('ia_empresa_config').select('*'),
    supabase.from('ia_consumo').select('empresa_id, tokens_entrada, tokens_saida, tokens_total, status, provedor, modelo, funcionalidade, created_at').gte('created_at', mesInicio),
  ])

  const configs = new Map((configsRes.data ?? []).map(config => [config.empresa_id, config]))
  const consumo = new Map<string, { requisicoes: number; tokens: number; tokensEntrada: number; tokensSaida: number; erros: number }>()
  for (const item of consumoRes.data ?? []) {
    const atual = consumo.get(item.empresa_id) ?? { requisicoes: 0, tokens: 0, tokensEntrada: 0, tokensSaida: 0, erros: 0 }
    atual.requisicoes++
    atual.tokens += Number(item.tokens_total ?? 0)
    atual.tokensEntrada += Number(item.tokens_entrada ?? 0)
    atual.tokensSaida += Number(item.tokens_saida ?? 0)
    if (item.status === 'erro') atual.erros++
    consumo.set(item.empresa_id, atual)
  }

  const linhas: EmpresaIA[] = (empresas ?? []).map(empresa => {
    const config = configs.get(empresa.id)
    return {
      empresaId: empresa.id,
      empresaNome: empresa.nome,
      habilitado: config?.habilitado ?? true,
      provedor: config?.provedor ?? 'herdar',
      modelo: config?.modelo ?? '',
      limiteRequisicoesMes: config?.limite_requisicoes_mes ?? 300,
      limiteTokensMes: config?.limite_tokens_mes ?? 1000000,
      maxTokensResposta: config?.max_tokens_resposta ?? 1200,
      fallbackAutomatico: config?.fallback_automatico ?? true,
      uso: consumo.get(empresa.id) ?? { requisicoes: 0, tokens: 0, tokensEntrada: 0, tokensSaida: 0, erros: 0 },
    }
  })

  const global: GlobalIA = {
    provedor: globalRes.data?.provedor_padrao ?? 'automatico',
    modelo: globalRes.data?.modelo_padrao ?? '',
    limiteRequisicoes: globalRes.data?.limite_requisicoes_padrao ?? 300,
    limiteTokens: globalRes.data?.limite_tokens_padrao ?? 1000000,
    maxTokensResposta: globalRes.data?.max_tokens_resposta ?? 1200,
    timeoutSegundos: globalRes.data?.timeout_segundos ?? 25,
    fallbackAutomatico: globalRes.data?.fallback_automatico ?? true,
  }

  return <IAAdminClient empresas={linhas} globalInicial={global} provedores={{
    anthropic: { configurado: Boolean(process.env.ANTHROPIC_API_KEY), origem: 'ANTHROPIC_API_KEY' },
    openai: { configurado: Boolean(process.env.OPENAI_API_KEY), origem: 'OPENAI_API_KEY' },
  }} schemaDisponivel={!globalRes.error && !configsRes.error && !consumoRes.error} />
}
