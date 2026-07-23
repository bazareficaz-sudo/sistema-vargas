import { brasilNFeRequest, tipoAmbiente, type BrasilNFeCredentials } from './client'
import { FiscalProviderError, type DfeListaResultado, type TipoManifesto } from '../types'

// Distribuição DFe / manifesto do destinatário da Brasil NFe — confirmado
// por escrito com o suporte deles (2026-07) e pela doc oficial
// (brasilnfe.com.br/api/consultas e /api/eventos-nf-e-nfc-e): a Brasil NFe
// importa as NFe's emitidas contra o CNPJ da empresa e já faz o manifesto
// automático de ciência; a consulta/manifesto explícito acontece por aqui.
//
// Duas correções feitas com base em teste direto contra a API de produção
// (não só a doc resumida por IA, que se mostrou errada nos dois pontos):
//
// 1. TipoDocumentoFiscal: a doc dizia "0 = Entradas, 1 = Saídas", mas o
//    teste real mostrou o oposto — TipoDocumentoFiscal=0 devolveu notas
//    com CnpjEmissor = o próprio CNPJ da empresa (ou seja, são as SAÍDAS,
//    as NFC-e que a própria empresa emite), e TipoDocumentoFiscal=1 (o
//    valor correto pra ENTRADAS/notas de fornecedor) devolveu vazio no
//    teste — o que pode ser porque ainda não há nenhuma nota de
//    fornecedor rastreada pela Brasil NFe pra este CNPJ (vale confirmar
//    com o suporte deles se isso exige alguma habilitação separada).
//
// 2. Paginação: diferente da Focus (que pagina de verdade por
//    versão/NSU), a Brasil NFe não tem cursor incremental aqui — é uma
//    busca por período (DtInicio/DtFim) só. A implementação anterior
//    tratava `ultimaVersao` como o início da janela da PRÓXIMA consulta,
//    o que fazia a janela encolher a cada clique em "Atualizar" (da data
//    da última consulta até agora) — na prática, depois do primeiro
//    clique, a consulta seguinte só via os últimos minutos, perdendo
//    tudo que fosse mais antigo. Agora a janela é sempre fixa (últimos
//    180 dias, prazo usual de relevância pra manifestação do
//    destinatário) a partir de "agora", em toda consulta.
const JANELA_DIAS = 180

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

export async function listarDfe(creds: BrasilNFeCredentials, _cnpj: string, _ultimaVersao: string): Promise<DfeListaResultado> {
  const agora = new Date()
  const dtInicio = new Date(agora.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000)

  const { status, text } = await brasilNFeRequest(creds, '/services/fiscal/ObterNotasFiscais', {
    TipoAmbiente: tipoAmbiente(creds.ambiente),
    TipoDocumentoFiscal: 1, // 1 = entradas (notas de fornecedor contra o CNPJ) — confirmado por teste real, doc tinha 0/1 trocados
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
    TipoDocumentoFiscal: 1, // entrada (ver nota em listarDfe)
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
