import { brasilNFeRequest, tipoAmbiente, type BrasilNFeCredentials } from './client'
import { FiscalProviderError, type DfeListaResultado, type TipoManifesto } from '../types'

// Distribuição DFe / manifesto do destinatário da Brasil NFe — confirmado
// por escrito com o suporte deles (2026-07) e pela doc oficial
// (brasilnfe.com.br/api/consultas e /api/eventos-nf-e-nfc-e): a Brasil NFe
// importa as NFe's emitidas contra o CNPJ da empresa e já faz o manifesto
// automático de ciência; a consulta/manifesto explícito acontece por aqui.
//
// Correções feitas com base em teste direto contra a API de produção (não
// só a doc resumida por IA, que se mostrou pouco confiável neste endpoint):
//
// 1. TipoDocumentoFiscal (0/1): testado nos dois valores contra o CNPJ
//    real do Bazar Eficaz — 0 devolveu só notas onde a própria empresa é
//    emitente (SAÍDA), e 1 devolveu o erro "Não existe notas fiscais para
//    o período informado" mesmo havendo notas de fornecedor genuínas no
//    período (confirmado comparando com o painel da Brasil NFe, que
//    mostrava 767 notas recebidas). Ou seja, o parâmetro em si não
//    funciona como documentado pra filtrar direção — a solução que
//    funciona de verdade é OMITIR esse campo (devolve tudo, entrada e
//    saída misturadas) e classificar no nosso lado comparando
//    CnpjDestinatario/CnpjEmissor com o CNPJ da empresa.
//
// 2. Entre as ~2000 notas "entrada" que sobram após esse filtro, a
//    grande maioria (ModeloDocumento=57) são CT-e de frete de
//    marketplace (Shopee/eBazar — valores pequenos, tipo R$2-20), não
//    XML de compra de mercadoria. Só ModeloDocumento=55 é NF-e de
//    verdade — filtramos só esses pra não inundar a tela de "Entrada
//    por XML" com frete que o parser de NF-e nem entende.
//
// 3. Paginação: diferente da Focus (que pagina de verdade por
//    versão/NSU), a Brasil NFe não tem cursor incremental aqui — é uma
//    busca por período (DtInicio/DtFim) só. Por isso a janela de busca é
//    sempre fixa (últimos 180 dias a partir de "agora"), nunca baseada
//    na última consulta — tratar isso como cursor incremental faz a
//    janela encolher a cada clique em "Atualizar" e perder notas antigas.
//
// 4. Download do XML (ObterArquivoNotaFiscal): testado com uma nota de
//    fornecedor bem recente (emitida no dia anterior) e voltou vazio,
//    mesmo com TipoAmbiente/TipoDocumentoFiscal variados. A hipótese mais
//    provável (e é assim que funciona a Distribuição DFe de verdade na
//    SEFAZ, fora da Brasil NFe) é que o XML completo só fica disponível
//    pra download DEPOIS que o destinatário dá ciência da operação — ou
//    seja, a ordem certa é: listar → manifestar Ciência → só então
//    baixar/importar. Não validei essa hipótese chamando manifestação de
//    verdade (é uma declaração fiscal real, não algo pra testar sozinho
//    sem o usuário) — vale confirmar na tela.
const JANELA_DIAS = 180
const MODELO_NFE = 55

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

export async function listarDfe(creds: BrasilNFeCredentials, cnpj: string, _ultimaVersao: string): Promise<DfeListaResultado> {
  const agora = new Date()
  const dtInicio = new Date(agora.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000)
  const cnpjLimpo = cnpj.replace(/\D/g, '')

  const { status, text } = await brasilNFeRequest(creds, '/services/fiscal/ObterNotasFiscais', {
    TipoAmbiente: tipoAmbiente(creds.ambiente),
    // Sem TipoDocumentoFiscal de propósito (ver nota acima) — devolve
    // entrada+saída misturadas, filtradas abaixo.
    DtInicio: dtInicio.toISOString(),
    DtFim: agora.toISOString(),
  })
  let json: any
  try {
    json = text ? JSON.parse(text) : []
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Brasil NFe ao listar notas recebidas (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }
  if (status >= 400) {
    throw new FiscalProviderError(json?.Error ?? `Erro ${status} ao listar notas recebidas na Brasil NFe`, 'brasilnfe_erro', json)
  }
  // "Não existe notas fiscais para o período informado" vem como um
  // `Error` de negócio dentro de uma resposta 200 — não é uma falha de
  // verdade, é só o período vazio. Trata como lista vazia, não como erro.
  const lista: any[] = Array.isArray(json) ? json : (Array.isArray(json?.Notas) ? json.Notas : (Array.isArray(json?.NotasFiscais) ? json.NotasFiscais : []))
  const entradas = lista.filter(d =>
    (d?.CnpjDestinatario ?? '').replace(/\D/g, '') === cnpjLimpo && Number(d?.ModeloDocumento) === MODELO_NFE
  )
  return { ultimaVersao: agora.toISOString(), documentos: entradas.map(normalizarDocumento) }
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
