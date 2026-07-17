import { focusRequest, type FocusCredentials } from './client'
import { FiscalProviderError, type DfeListaResultado, type TipoManifesto } from '../types'

// Refactor 1:1 do que já existia em src/app/api/sefaz/route.ts — mesmos
// endpoints, mesmo comportamento. `listarDfe` deliberadamente NÃO normaliza
// a lista de notas (só extrai `ultimo_nsu`, que é o único campo que o
// resto do sistema hoje precisa) porque não há documentação pública
// confirmada do shape completo da distribuição DFe — arriscar uma
// normalização errada quebraria silenciosamente o único consumidor real
// (EntradasXmlClient.tsx), que já sabe ler o formato bruto da Focus.

const TIPO_MANIFESTO: Record<TipoManifesto, string> = {
  ciencia: 'ciencia_operacao',
  confirmacao: 'confirmacao_operacao',
  desconhecimento: 'desconhecimento_operacao',
  nao_realizada: 'operacao_nao_realizada',
}

export async function listarDfe(creds: FocusCredentials, ultimoNsu: string): Promise<DfeListaResultado> {
  const { status, text } = await focusRequest(creds, '/distribuicao/dfe', { query: { ultimo_nsu: ultimoNsu } })
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Focus NFe ao listar distribuição (status ${status})`, 'resposta_invalida')
  }
  if (status >= 400) {
    throw new FiscalProviderError(json?.mensagem ?? json?.erro ?? `Erro ${status} ao listar distribuição DFe`, 'focus_erro', json)
  }
  return { ultimoNsu: json?.ultimo_nsu ?? null, raw: json }
}

export async function manifestar(creds: FocusCredentials, chave: string, tipo: TipoManifesto, justificativa?: string): Promise<void> {
  const { status, text } = await focusRequest(creds, `/nfe/${chave}/manifesto`, {
    method: 'POST',
    body: { tipo: TIPO_MANIFESTO[tipo], ...(justificativa ? { justificativa } : {}) },
  })
  if (status >= 400) {
    let json: any = {}
    try { json = text ? JSON.parse(text) : {} } catch {}
    throw new FiscalProviderError(json?.mensagem ?? json?.erro ?? `Erro ${status} ao manifestar`, 'focus_erro', json)
  }
}

export async function baixarXml(creds: FocusCredentials, chave: string): Promise<string> {
  const { status, text } = await focusRequest(creds, `/nfe/${chave}.xml`)
  if (status >= 400) {
    throw new FiscalProviderError(`Erro ${status} ao baixar XML da nota ${chave}`, 'focus_erro')
  }
  return text
}
