import { focusRequest, type FocusCredentials } from './client'
import { FiscalProviderError, type EmissaoNFCeInput, type EmissaoNFCeResultado, type StatusNFCe } from '../types'

const HOST_PRODUCAO = 'https://api.focusnfe.com.br'
const HOST_HOMOLOGACAO = 'https://homologacao.focusnfe.com.br'

// Focus devolve os caminhos de DANFE/XML como path relativo (ex:
// "/notas_fiscais_consumidor/....html") — precisa do host certo (produção
// ou homologação) na frente pra virar um link clicável de verdade.
function urlAbsoluta(ambiente: 'producao' | 'homologacao', path?: string | null): string | undefined {
  if (!path) return undefined
  if (path.startsWith('http')) return path
  const host = ambiente === 'homologacao' ? HOST_HOMOLOGACAO : HOST_PRODUCAO
  return host + path
}

// Endpoints confirmados contra a doc pública da Focus (doc.focusnfe.com.br,
// confiança alta — diferente da Shopee, não precisou de fonte secundária):
// POST /nfce (síncrono — autoriza ou rejeita na mesma requisição),
// GET /nfce/{ref}, DELETE /nfce/{ref}. O que NÃO foi confirmado 100%: o
// código exato de PIX em formas_pagamento (usamos '17', da tabela nacional
// SEFAZ de formas de pagamento — não é campo específico da Focus, então a
// confiança é alta mesmo sem estar explícito na doc da Focus).

const STATUS_MAP: Record<string, StatusNFCe> = {
  autorizado: 'autorizada',
  erro_autorizacao: 'rejeitada',
  denegado: 'rejeitada',
  cancelado: 'cancelada',
  processando_autorizacao: 'processando',
}

function mapResultado(json: any, ambiente: 'producao' | 'homologacao'): EmissaoNFCeResultado {
  const status = STATUS_MAP[json?.status] ?? 'erro'
  return {
    status,
    chave: json?.chave_nfe ?? undefined,
    numero: json?.numero ?? undefined,
    serie: json?.serie ?? undefined,
    protocolo: json?.numero_protocolo ?? undefined,
    xmlUrl: urlAbsoluta(ambiente, json?.caminho_xml_nota_fiscal),
    danfeUrl: urlAbsoluta(ambiente, json?.caminho_danfe),
    motivoRejeicao: status === 'rejeitada' || status === 'erro' ? (json?.mensagem_sefaz ?? json?.mensagem ?? json?.erro) : undefined,
    dadosBrutos: json,
  }
}

function montarPayload(input: EmissaoNFCeInput) {
  return {
    cnpj_emitente: input.cnpjEmitente.replace(/\D/g, ''),
    data_emissao: new Date().toISOString(),
    presenca_comprador: '1',   // operação presencial — padrão do PDV de balcão
    modalidade_frete: '9',     // sem frete — padrão do NFC-e de balcão
    local_destino: '1',        // operação interna (mesmo estado)
    natureza_operacao: input.naturezaOperacao,
    ...(input.destinatario?.cpf || input.destinatario?.cnpj ? {
      nome_destinatario: input.destinatario.nome,
      cpf_destinatario: input.destinatario.cpf || undefined,
      cnpj_destinatario: input.destinatario.cnpj || undefined,
      indicador_inscricao_estadual_destinatario: '9', // não contribuinte — padrão do consumidor final no NFC-e
    } : {}),
    items: input.itens.map(it => ({
      numero_item: it.numeroItem,
      codigo_produto: it.codigoProduto,
      descricao: it.descricao,
      codigo_ncm: it.ncm,
      cfop: it.cfop,
      quantidade_comercial: it.quantidade,
      quantidade_tributavel: it.quantidade,
      unidade_comercial: it.unidade,
      unidade_tributavel: it.unidade,
      valor_unitario_comercial: it.valorUnitario,
      valor_unitario_tributavel: it.valorUnitario,
      valor_bruto: Math.round(it.quantidade * it.valorUnitario * 100) / 100,
      valor_desconto: it.valorDesconto || 0,
      icms_origem: it.icmsOrigem,
      icms_situacao_tributaria: it.icmsSituacaoTributaria,
      valor_total_tributos: 0, // não calculado nesta versão — ver limitações no plano
    })),
    formas_pagamento: input.pagamentos.map(p => ({
      forma_pagamento: p.codigoSefaz,
      valor_pagamento: p.valor,
    })),
  }
}

export async function emitirNFCe(creds: FocusCredentials, input: EmissaoNFCeInput): Promise<EmissaoNFCeResultado> {
  const { status, text } = await focusRequest(creds, '/nfce', {
    method: 'POST',
    query: { ref: input.referencia, completa: '1' },
    body: montarPayload(input),
  })

  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Focus NFe ao emitir (status ${status}): ${text.slice(0, 300)}`, 'resposta_invalida')
  }

  // Diferente de distribuição/manifesto, um HTTP 4xx aqui pode ser um
  // resultado de NEGÓCIO válido (ex: erro_autorizacao — a SEFAZ rejeitou,
  // mas a chamada em si funcionou) — só trata como exceção quando a
  // resposta nem tem um `status` reconhecível (autenticação, payload
  // malformado antes de chegar na SEFAZ, etc).
  if (!json?.status) {
    throw new FiscalProviderError(json?.mensagem ?? json?.erro ?? `Erro ${status} ao emitir NFC-e`, 'focus_erro', json)
  }

  return mapResultado(json, creds.ambiente)
}

export async function consultarNFCe(creds: FocusCredentials, referencia: string): Promise<EmissaoNFCeResultado> {
  const { status, text } = await focusRequest(creds, `/nfce/${referencia}`)
  let json: any
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new FiscalProviderError(`Resposta inesperada da Focus NFe ao consultar (status ${status})`, 'resposta_invalida')
  }
  if (!json?.status) {
    throw new FiscalProviderError(json?.mensagem ?? json?.erro ?? `Erro ${status} ao consultar NFC-e`, 'focus_erro', json)
  }
  return mapResultado(json, creds.ambiente)
}

export async function cancelarNFCe(creds: FocusCredentials, referencia: string, justificativa: string): Promise<{ ok: boolean; erro?: string }> {
  const { status, text } = await focusRequest(creds, `/nfce/${referencia}`, {
    method: 'DELETE',
    body: { justificativa },
  })
  if (status >= 400) {
    let json: any = {}
    try { json = text ? JSON.parse(text) : {} } catch {}
    return { ok: false, erro: json?.mensagem ?? json?.erro ?? `Erro ${status} ao cancelar NFC-e` }
  }
  return { ok: true }
}
