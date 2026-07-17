import { brasilNFeRequest, tipoAmbiente, type BrasilNFeCredentials } from './client'
import { FiscalProviderError, type EmissaoNFCeInput, type EmissaoNFCeResultado, type StatusNFCe } from '../types'

// Endpoints e formatos cruzados contra o SDK PHP oficial da Brasil NFe
// (github.com/BrasilNFe/brasilnfe-php-sdk) — valores monetários em decimal
// (não centavos), TipoAmbiente 1=produção/2=homologação, auth só com header
// Token (UserToken é só pro módulo de empresa/certificado, não usado aqui).
// O que NÃO foi possível confirmar com boa fonte: alíquota de ICMS por item
// (nosso cadastro de produto não guarda isso hoje — omitido do payload,
// o que tende a ser correto pra Simples Nacional/CSOSN, mas não foi
// validado contra um regime de Lucro Presumido/Real real).

function montarPayload(input: EmissaoNFCeInput, ambiente: 'producao' | 'homologacao') {
  return {
    ModeloDocumento: 65,
    TipoAmbiente: tipoAmbiente(ambiente),
    DataEmissao: new Date().toISOString(),
    NaturezaOperacao: input.naturezaOperacao,
    ConsumidorFinal: true,
    IndicadorPresenca: 1, // operação presencial — padrão do PDV de balcão
    ...(input.destinatario?.cpf || input.destinatario?.cnpj ? {
      Cliente: {
        CpfCnpj: input.destinatario.cpf || input.destinatario.cnpj,
        NmCliente: input.destinatario.nome,
        IndicadorIe: 9, // não contribuinte — padrão do consumidor final no NFC-e
      },
    } : {}),
    Produtos: input.itens.map(it => ({
      CodProdutoServico: it.codigoProduto,
      NmProduto: it.descricao,
      NCM: it.ncm,
      CFOP: Number(it.cfop),
      UnidadeComercial: it.unidade,
      Quantidade: it.quantidade,
      ValorUnitario: it.valorUnitario,
      Imposto: {
        ICMS: { CodSituacaoTributaria: it.icmsSituacaoTributaria },
      },
    })),
    Pagamentos: input.pagamentos.map(p => ({
      FormaPagamento: p.codigoSefaz,
      VlPago: p.valor,
    })),
  }
}

function base64ParaDataUrl(base64: string | undefined, mime: string): string | undefined {
  if (!base64) return undefined
  return `data:${mime};base64,${base64}`
}

function mapResultado(json: any): EmissaoNFCeResultado {
  const ret = json?.ReturnNF ?? {}
  const ok = ret.Ok === true
  const status: StatusNFCe = ok ? 'autorizada' : 'rejeitada'
  return {
    status,
    chave: ret.ChaveNF ?? undefined,
    numero: ret.Numero != null ? String(ret.Numero) : undefined,
    serie: ret.Serie != null ? String(ret.Serie) : undefined,
    protocolo: ret.NumeroProtocolo ?? undefined,
    xmlUrl: base64ParaDataUrl(json?.Base64Xml, 'application/xml'),
    danfeUrl: base64ParaDataUrl(json?.Base64File, 'application/pdf'),
    motivoRejeicao: !ok ? (ret.DsStatusRespostaSefaz ?? json?.Error ?? 'Rejeitado pela SEFAZ') : undefined,
    dadosBrutos: json,
  }
}

export async function emitirNFCe(creds: BrasilNFeCredentials, input: EmissaoNFCeInput): Promise<EmissaoNFCeResultado> {
  const { status, text } = await brasilNFeRequest(creds, '/services/fiscal/EnviarNotaFiscal', montarPayload(input, creds.ambiente))

  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Brasil NFe ao emitir (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }

  // Igual à Focus: um HTTP 4xx pode ser um resultado de negócio válido
  // (rejeição da SEFAZ), não necessariamente uma falha de infraestrutura —
  // só trata como exceção quando a resposta nem tem o formato esperado.
  if (!json?.ReturnNF && !json?.Error) {
    throw new FiscalProviderError(`Erro ${status} ao emitir NFC-e na Brasil NFe`, 'brasilnfe_erro', json)
  }
  if (!json?.ReturnNF && json?.Error) {
    throw new FiscalProviderError(json.Error, 'brasilnfe_erro', json)
  }

  return mapResultado(json)
}

export async function consultarNFCe(): Promise<EmissaoNFCeResultado> {
  // A Brasil NFe não expõe (no que conseguimos confirmar na doc) uma
  // consulta por referência/chave isolada — só um endpoint de listagem por
  // período (ObterNotasFiscais). Como a emissão já é síncrona e devolve
  // tudo que precisamos na hora, não implementamos uma consulta best-effort
  // aqui pra não arriscar montar um filtro errado sem confiança na fonte.
  throw new FiscalProviderError(
    'Consulta de NFC-e por referência não é suportada pela Brasil NFe nesta integração — o resultado já vem completo na emissão.',
    'nao_suportado'
  )
}

export async function cancelarNFCe(
  creds: BrasilNFeCredentials, chave: string | undefined, protocolo: string | undefined, justificativa: string
): Promise<{ ok: boolean; erro?: string }> {
  if (!chave || !protocolo) {
    return { ok: false, erro: 'Faltam chave de acesso ou número de protocolo da nota — não é possível cancelar.' }
  }
  const { status, text } = await brasilNFeRequest(creds, '/services/fiscal/CancelarNotaFiscal', {
    ChaveNF: chave,
    NumeroProtocolo: protocolo,
    Justificativa: justificativa,
    NumeroSequencial: 1,
    DataEvento: new Date().toISOString(),
  })
  if (status >= 400) {
    let json: any = {}
    try { json = text ? JSON.parse(text) : {} } catch {}
    return { ok: false, erro: json?.Error ?? json?.ReturnNF?.DsStatusRespostaSefaz ?? `Erro ${status} ao cancelar NFC-e` }
  }
  return { ok: true }
}
