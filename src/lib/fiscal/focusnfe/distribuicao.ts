import { focusRequest, type FocusCredentials } from './client'
import { FiscalProviderError, type DfeListaResultado, type TipoManifesto } from '../types'

// Endpoints confirmados contra a documentação oficial da Focus NFe
// (doc.focusnfe.com.br/reference/consultar_nfes_recebidas,
// manifestar_nfe_recebida, consultar_nfe_recebida_individual_xml) — a
// implementação anterior usava /distribuicao/dfe com ultimo_nsu, que não
// corresponde a nenhum endpoint documentado atual da Focus; o endpoint
// real é /nfes_recebidas (paginado por `versao`, não por NSU).

const TIPO_MANIFESTO: Record<TipoManifesto, string> = {
  ciencia: 'ciencia',
  confirmacao: 'confirmacao',
  desconhecimento: 'desconhecimento',
  nao_realizada: 'nao_realizada',
}

// `cnpj` é obrigatório na consulta (não é inferido do token) — vem de
// empresas.cnpj no chamador. `ultimaVersao` é o cursor de paginação: passe
// vazio/'0' na primeira consulta, depois sempre o valor devolvido aqui.
export async function listarDfe(creds: FocusCredentials, cnpj: string, ultimaVersao: string): Promise<DfeListaResultado> {
  const query: Record<string, string> = { cnpj: cnpj.replace(/\D/g, '') }
  if (ultimaVersao && ultimaVersao !== '0') query.versao = ultimaVersao

  const { status, text, headers } = await focusRequest(creds, '/nfes_recebidas', { query })
  let json: any
  try {
    json = text ? JSON.parse(text) : []
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Focus NFe ao listar NFe's recebidas (status ${status})`, 'resposta_invalida')
  }
  if (status >= 400) {
    throw new FiscalProviderError(json?.mensagem ?? json?.erro ?? `Erro ${status} ao listar NFe's recebidas`, 'focus_erro', json)
  }
  const documentos: any[] = Array.isArray(json) ? json : (json?.documentos ?? [])
  return { ultimaVersao: headers.get('X-Max-Version'), documentos }
}

export async function manifestar(creds: FocusCredentials, chave: string, tipo: TipoManifesto, justificativa?: string): Promise<void> {
  const { status, text } = await focusRequest(creds, `/nfes_recebidas/${chave}/manifesto`, {
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
  const { status, text } = await focusRequest(creds, `/nfes_recebidas/${chave}.xml`)
  if (status >= 400) {
    throw new FiscalProviderError(`Erro ${status} ao baixar XML da nota ${chave}`, 'focus_erro')
  }
  return text
}
