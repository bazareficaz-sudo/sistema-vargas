// Tipos normalizados do FiscalProvider — nenhum lugar fora de
// src/lib/fiscal/<provider>/ deve conhecer o formato específico de um
// provedor (Focus, Brasil NFe, ...). Provider-specific fica só na tradução
// dentro de cada implementação.

export type TipoManifesto = 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada'

// Resultado de listar NFe's recebidas (GET /nfes_recebidas da Focus NFe,
// confirmado contra a documentação oficial em doc.focusnfe.com.br).
// `documentos` é o array cru de NfeRecebidaResumo — o único consumidor hoje
// (EntradasXmlClient.tsx) já sabe interpretar esse formato. `ultimaVersao`
// vem do header X-Max-Version da resposta e deve ser salvo pra paginar a
// próxima consulta (evita reler os mesmos documentos sempre).
export type DfeListaResultado = {
  ultimaVersao: string | null
  documentos: any[]
}

export type EmissaoNFCeItem = {
  numeroItem: number
  produtoId: string
  codigoProduto: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number
  valorDesconto: number
  icmsOrigem: string
  icmsSituacaoTributaria: string
}

export type EmissaoNFCePagamento = {
  forma: string        // id interno do PDV: dinheiro|debito|credito|pix|carteira|fiado
  codigoSefaz: string  // código da tabela nacional de formas de pagamento (ex: '01', '17')
  valor: number
}

export type EmissaoNFCeInput = {
  referencia: string          // id único desta emissão no nosso sistema (usamos vendas.id)
  cnpjEmitente: string
  naturezaOperacao: string
  destinatario?: {
    nome?: string
    cpf?: string
    cnpj?: string
  }
  itens: EmissaoNFCeItem[]
  pagamentos: EmissaoNFCePagamento[]
}

export type StatusNFCe = 'autorizada' | 'rejeitada' | 'cancelada' | 'processando' | 'erro'

export type EmissaoNFCeResultado = {
  status: StatusNFCe
  chave?: string
  numero?: string
  serie?: string
  protocolo?: string
  xmlUrl?: string
  danfeUrl?: string
  motivoRejeicao?: string
  dadosBrutos?: any
}

export class FiscalProviderError extends Error {
  constructor(message: string, public codigo: string, public dadosBrutos?: any) {
    super(message)
    this.name = 'FiscalProviderError'
  }
}
