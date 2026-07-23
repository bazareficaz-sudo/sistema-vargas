import { brasilNFeRequest, tipoAmbiente, type BrasilNFeCredentials } from './client'
import { FiscalProviderError, type DfeListaResultado, type TipoManifesto } from '../types'

// Distribuição DFe / manifesto do destinatário da Brasil NFe — confirmado
// por escrito com o suporte deles (2026-07) e pela doc oficial
// (brasilnfe.com.br/api/consultas e /api/eventos-nf-e-nfc-e): a Brasil NFe
// importa as NFe's emitidas contra o CNPJ da empresa e já faz o manifesto
// automático de ciência; a consulta/manifesto explícito acontece por aqui.
// Diferente da Focus (paginação incremental por versão/NSU), aqui a
// consulta é por período (DtInicio/DtFim) — não existe cursor incremental
// real, então tratamos `ultimaVersao` como a data ISO da última consulta
// bem-sucedida (janela de busca = [ultimaVersao, agora]), com fallback de
// 90 dias pra primeira consulta.

const TIPO_MANIFESTACAO: Record<TipoManifesto, number> = {
  confirmacao: 1,
  ciencia: 2,
  desconhecimento: 3,
  nao_realizada: 4,
}

function normalizarDocumento(d: any) {
  return {
    chave_nfe: d?.Chave ?? null,
    numero: d?.Numero ?? null,
    serie: d?.Serie ?? null,
    nome_emitente: d?.NomeEmissor ?? null,
    cnpj_emitente: d?.CnpjEmissor ?? null,
    valor_total: Number(d?.Valor ?? 0),
    data_emissao: d?.DtEmissao ?? null,
    status: d?.Status ?? null,
    manifestado: null as string | null,
  }
}

export async function listarDfe(creds: BrasilNFeCredentials, _cnpj: string, ultimaVersao: string): Promise<DfeListaResultado> {
  const agora = new Date()
  const inicioValido = ultimaVersao && ultimaVersao !== '0' && !isNaN(Date.parse(ultimaVersao))
  const dtInicio = inicioValido ? new Date(ultimaVersao) : new Date(agora.getTime() - 90 * 24 * 60 * 60 * 1000)

  const { status, text } = await brasilNFeRequest(creds, '/services/fiscal/ObterNotasFiscais', {
    TipoAmbiente: tipoAmbiente(creds.ambiente),
    TipoDocumentoFiscal: 0, // 0 = entradas (notas contra o CNPJ da empresa)
    DtInicio: dtInicio.toISOString(),
    DtFim: agora.toISOString(),
  })
  let json: any
  try {
    json = text ? JSON.parse(text) : []
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Brasil NFe ao listar notas recebidas (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }
  if (status >= 400 || json?.Error) {
    throw new FiscalProviderError(json?.Error ?? `Erro ${status} ao listar notas recebidas na Brasil NFe`, 'brasilnfe_erro', json)
  }
  const lista: any[] = Array.isArray(json) ? json : (Array.isArray(json?.NotasFiscais) ? json.NotasFiscais : [])
  return { ultimaVersao: agora.toISOString(), documentos: lista.map(normalizarDocumento) }
}

export async function manifestar(creds: BrasilNFeCredentials, chave: string, tipo: TipoManifesto, justificativa?: string): Promise<void> {
  const body: Record<string, any> = {
    TipoAmbiente: tipoAmbiente(creds.ambiente),
    TipoManifestacao: TIPO_MANIFESTACAO[tipo],
    Chave: chave,
  }
  if (tipo === 'nao_realizada') body.Justificativa = justificativa ?? 'Operação não realizada'

  const { status, text } = await brasilNFeRequest(creds, '/services/fiscal/ManifestarNotaFiscal', body)
  if (status >= 400) {
    let json: any = {}
    try { json = text ? JSON.parse(text) : {} } catch {}
    throw new FiscalProviderError(json?.Error ?? `Erro ${status} ao manifestar na Brasil NFe`, 'brasilnfe_erro', json)
  }
}

export async function baixarXml(creds: BrasilNFeCredentials, chave: string): Promise<string> {
  const { status, text } = await brasilNFeRequest(creds, '/services/fiscal/ObterArquivoNotaFiscal', {
    ChaveNF: chave,
    FileType: 1, // 1 = XML
    TipoDocumentoFiscal: 0, // entrada
  })
  if (status >= 400) {
    throw new FiscalProviderError(`Erro ${status} ao baixar XML da nota ${chave} na Brasil NFe`, 'brasilnfe_erro')
  }
  // Resposta é uma string JSON com o conteúdo em Base64 puro (doc oficial).
  let base64 = text
  try {
    const json = JSON.parse(text)
    base64 = typeof json === 'string' ? json : (json?.Arquivo ?? json?.arquivo ?? text)
  } catch {
    // já veio como string crua (sem envelope JSON) — usa como está
  }
  return Buffer.from(base64, 'base64').toString('utf-8')
}
