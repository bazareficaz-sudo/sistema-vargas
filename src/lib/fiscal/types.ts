// Tipos normalizados do FiscalProvider — nenhum lugar fora de
// src/lib/fiscal/<provider>/ deve conhecer o formato específico de um
// provedor (Focus, Brasil NFe, ...). Provider-specific fica só na tradução
// dentro de cada implementação.

export type TipoManifesto = 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada'

// Resultado de listar a distribuição DFe. Deliberadamente NÃO normalizado
// item a item (ver nota em focusnfe/distribuicao.ts): o único consumidor
// hoje (EntradasXmlClient.tsx) já sabe interpretar o formato bruto da Focus,
// e não há documentação pública confirmada do shape pra arriscar uma
// normalização errada. `raw` é repassado como veio do provedor.
export type DfeListaResultado = {
  ultimoNsu: string | null
  raw: any
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
