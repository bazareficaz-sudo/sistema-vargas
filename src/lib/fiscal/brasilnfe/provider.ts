import type { FiscalProvider } from '../provider'
import type { BrasilNFeCredentials } from './client'
import * as emissao from './emissao'

// Distribuição DFe / manifesto do destinatário: não encontramos nenhum
// endpoint documentado pra isso na Brasil NFe (nem na doc em prosa nem nos
// módulos do SDK oficial — NotaFiscal/Eventos/Consultas/Arquivos/Empresa,
// nenhum cobre "documentos recebidos"). Diferente de emissão, aqui não é
// uma questão de confiança baixa — é ausência confirmada da capacidade.
// Empresa que usa Brasil NFe continua precisando da Focus (ou config
// separada) pro fluxo de entrada/XML de fornecedor.
function semDistribuicao(): never {
  throw new Error('Brasil NFe não oferece distribuição DFe/manifesto do destinatário — use a Focus NFe para o fluxo de entrada (XML de fornecedor).')
}

export function createBrasilNFeProvider(creds: BrasilNFeCredentials): FiscalProvider {
  return {
    nome: 'brasilnfe',
    distribuicao: {
      listarDfe: async () => semDistribuicao(),
      manifestar: async () => semDistribuicao(),
      baixarXml: async () => semDistribuicao(),
    },
    emissao: {
      emitirNFCe: (input) => emissao.emitirNFCe(creds, input),
      consultarNFCe: () => emissao.consultarNFCe(),
      cancelarNFCe: (alvo, justificativa) => emissao.cancelarNFCe(creds, alvo.chave, alvo.protocolo, justificativa),
    },
  }
}
