import { brasilNFeRequest, tipoAmbiente, type BrasilNFeCredentials } from './client'
import { FiscalProviderError, type EmissaoNFCeInput, type EmissaoNFCeItem, type EmissaoNFCeResultado, type EmissaoNFeInput, type StatusNFCe } from '../types'

// Endpoints e formatos cruzados contra o SDK PHP oficial da Brasil NFe
// (github.com/BrasilNFe/brasilnfe-php-sdk) — valores monetários em decimal
// (não centavos), TipoAmbiente 1=produção/2=homologação, auth só com header
// Token (UserToken é só pro módulo de empresa/certificado, não usado aqui).
// O que NÃO foi possível confirmar com boa fonte: alíquota de ICMS por item
// (nosso cadastro de produto não guarda isso hoje — omitido do payload,
// o que tende a ser correto pra Simples Nacional/CSOSN, mas não foi
// validado contra um regime de Lucro Presumido/Real real).

// Campos obrigatórios confirmados um a um contra a API real em homologação
// (2026-07), porque a doc em prosa não lista o que é obrigatório:
// - Finalidade (1 Normal): sem ele → "A Finalidade da NF informada é inválida."
// - IdentificadorInterno: sem ele → "Identificador Interno não foi enviado
//   (A verificação do identificador interno esta ativada)". Serve de chave de
//   idempotência do lado deles; usamos o id da venda.
// - ValorTotal por produto: sem ele o desconto é comparado contra zero
//   ("O valor de desconto do produto é maior que o valor total").
// - PIS e COFINS por produto: sem eles → "Os dados de impostos PIS/COFINS do
//   produto não foi informado."
// Não enviamos alíquota de ICMS/PIS/COFINS: a API aceitou CST 00 e CSOSN 102
// sem alíquota, e o cadastro de produto não obriga esses percentuais hoje.
// Item da nota — o mesmo formato na NFC-e e na NF-e.
function produtoPayload(it: EmissaoNFCeItem) {
  return {
    CodProdutoServico: it.codigoProduto,
    NmProduto: it.descricao,
    NCM: it.ncm,
    // `Produtos[].CEST`, string de 7 dígitos, irmão de NCM — conferido na
    // referência da própria Brasil NFe, não deduzido do padrão dos outros
    // campos. Só vai quando existe: mandar vazio num produto sem ST seria
    // declarar substituição tributária onde não há.
    ...(it.cest ? { CEST: it.cest } : {}),
    CFOP: Number(it.cfop),
    UnidadeComercial: it.unidade,
    Quantidade: it.quantidade,
    ValorUnitario: it.valorUnitario,
    // Valor bruto do item; o desconto vai separado (é assim que a API
    // valida um contra o outro).
    ValorTotal: Number((it.quantidade * it.valorUnitario).toFixed(2)),
    ...(it.valorDesconto > 0 ? { ValorDesconto: it.valorDesconto } : {}),
    Imposto: {
      ICMS: { CodSituacaoTributaria: it.icmsSituacaoTributaria },
      PIS: { CodSituacaoTributaria: it.pisCst },
      COFINS: { CodSituacaoTributaria: it.cofinsCst },
    },
  }
}

function montarPayload(input: EmissaoNFCeInput, ambiente: 'producao' | 'homologacao') {
  return {
    ModeloDocumento: 65,
    TipoAmbiente: tipoAmbiente(ambiente),
    Finalidade: 1,
    IdentificadorInterno: input.referencia,
    // DataEmissao é omitida de propósito: a Brasil NFe estampa a hora local
    // dela. Enviar `new Date().toISOString()` (UTC) fazia a SEFAZ rejeitar
    // com "Data-Hora de Emissao posterior ao horario de recebimento" —
    // o horário de Brasília vai 3h atrás do UTC, então toda emissão parecia
    // estar no futuro. Confirmado em homologação: sem o campo, passa.
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
    Produtos: input.itens.map(produtoPayload),
    Pagamentos: input.pagamentos.map(p => ({
      FormaPagamento: p.codigoSefaz,
      VlPago: p.valor,
    })),
  }
}

// O tipo sai do CONTEÚDO, não do nome do campo: apesar de se chamar
// "Base64File", a DANFE da NFC-e que a Brasil NFe devolve é HTML, não PDF
// (verificado numa NFC-e autorizada de verdade). Rotular HTML como
// application/pdf faz o visualizador do navegador falhar ao abrir.
function base64ParaDataUrl(base64: string | undefined, mimePadrao: string): string | undefined {
  if (!base64) return undefined
  let mime = mimePadrao
  try {
    const inicio = Buffer.from(base64.slice(0, 64), 'base64').toString('utf8')
    if (/^\s*<(!doctype|html)/i.test(inicio)) mime = 'text/html'
    else if (inicio.startsWith('%PDF')) mime = 'application/pdf'
    else if (/^\s*<\?xml|^\s*<nfeProc/i.test(inicio)) mime = 'application/xml'
  } catch { /* mantém o padrão se não der pra inspecionar */ }
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
    // Só expõe XML/DANFE de nota autorizada. A Brasil NFe devolve Base64File
    // mesmo quando a SEFAZ rejeita, e esse PDF sai com cara de cupom válido
    // (inclusive com "Data de autorização") — guardar isso numa nota
    // rejeitada faz o sistema parecer ter emitido o que não emitiu.
    xmlUrl: ok ? base64ParaDataUrl(json?.Base64Xml, 'application/xml') : undefined,
    danfeUrl: ok ? base64ParaDataUrl(json?.Base64File, 'application/pdf') : undefined,
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

// NF-e modelo 55 — venda de marketplace. Nomes de campo conferidos contra o
// SDK PHP oficial (src/Envio/NFe/NotaFiscalEnvio.php): Cliente herda
// Endereco de Pessoa; Intermediador {Cnpj, IdCadIntTran} só vale com
// IndicadorPresenca 2/3/4/9; ICMS.AliquotaICMS e PIS/COFINS.Aliquota.
//
// CONFIRMADO EM HOMOLOGAÇÃO (03/10/2026, Bazar Eficaz → consumidor final em
// SP, pedido TikTok 586327006856971804, nota autorizada):
//   · DIFAL — o SDK não tem campo para o grupo ICMSUFDest, e não precisa: a
//     Brasil NFe monta o grupo sozinha quando a venda é interestadual a não
//     contribuinte (saiu pICMSUFDest 18, pICMSInter 12, vICMSUFDest 1,38).
//   · Código IBGE do município — basta nome e UF; a Brasil NFe preenche o
//     cMun do destinatário.
//   · Ela também tira o ICMS da base de PIS/COFINS (vBC do PIS = produto −
//     ICMS) — exclusão permitida (STF, Tema 69), mas é escolha que a
//     contabilidade precisa conhecer.
export function montarPayloadNFe(input: EmissaoNFeInput, ambiente: 'producao' | 'homologacao') {
  const d = input.destinatario
  return {
    ModeloDocumento: 55,
    TipoAmbiente: tipoAmbiente(ambiente),
    Finalidade: 1,
    IdentificadorInterno: input.referencia,
    NaturezaOperacao: input.naturezaOperacao,
    ConsumidorFinal: input.consumidorFinal,
    IndicadorPresenca: 2, // não presencial, pela internet
    ...(input.intermediador ? {
      Intermediador: { Cnpj: input.intermediador.cnpj, IdCadIntTran: input.intermediador.idCadastro },
    } : {}),
    Cliente: {
      CpfCnpj: d.cpf || d.cnpj,
      NmCliente: d.nome,
      IndicadorIe: d.indicadorIe,
      ...(d.inscricaoEstadual ? { Ie: d.inscricaoEstadual } : {}),
      Endereco: {
        Cep: d.endereco.cep,
        Logradouro: d.endereco.logradouro,
        Numero: d.endereco.numero,
        ...(d.endereco.complemento ? { Complemento: d.endereco.complemento } : {}),
        Bairro: d.endereco.bairro,
        Municipio: d.endereco.municipio,
        Uf: d.endereco.uf,
        CodPais: 1058,
        Pais: 'BRASIL',
      },
    },
    Produtos: input.itens.map(it => {
      const base = produtoPayload(it)
      return {
        ...base,
        OrigemProduto: Number(it.icmsOrigem),
        Imposto: {
          ICMS: {
            ...base.Imposto.ICMS,
            ...(it.aliquotaIcms != null ? { AliquotaICMS: it.aliquotaIcms } : {}),
          },
          PIS: { ...base.Imposto.PIS, ...(it.pisAliquota != null ? { Aliquota: it.pisAliquota } : {}) },
          COFINS: { ...base.Imposto.COFINS, ...(it.cofinsAliquota != null ? { Aliquota: it.cofinsAliquota } : {}) },
        },
      }
    }),
    Pagamentos: input.pagamentos.map(p => ({
      IndicadorPagamento: 0,
      FormaPagamento: p.codigoSefaz,
      VlPago: p.valor,
      ...(p.descricao ? { Descricao: p.descricao } : {}),
    })),
    Transporte: { ModalidadeFrete: input.modalidadeFrete },
    ...(input.observacao ? { Observacao: input.observacao } : {}),
  }
}

export async function emitirNFe(creds: BrasilNFeCredentials, input: EmissaoNFeInput): Promise<EmissaoNFCeResultado> {
  const { status, text } = await brasilNFeRequest(creds, '/services/fiscal/EnviarNotaFiscal', montarPayloadNFe(input, creds.ambiente))

  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Brasil NFe ao emitir NF-e (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }
  if (!json?.ReturnNF && !json?.Error) {
    throw new FiscalProviderError(`Erro ${status} ao emitir NF-e na Brasil NFe`, 'brasilnfe_erro', json)
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
