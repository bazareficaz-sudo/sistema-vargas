import type { FiscalProvider } from '../provider'
import type { BrasilNFeCredentials } from './client'
import * as emissao from './emissao'
import * as distribuicao from './distribuicao'

// Distribuição DFe / manifesto do destinatário — confirmado com o suporte
// da Brasil NFe (2026-07): eles importam as notas emitidas contra o CNPJ
// da empresa e permitem consultar/manifestar via API (ver distribuicao.ts).

export function createBrasilNFeProvider(creds: BrasilNFeCredentials): FiscalProvider {
  return {
    nome: 'brasilnfe',
    distribuicao: {
      listarDfe: (cnpj, ultimaVersao) => distribuicao.listarDfe(creds, cnpj, ultimaVersao),
      manifestar: (chave, tipo, justificativa) => distribuicao.manifestar(creds, chave, tipo, justificativa),
      baixarXml: (chave) => distribuicao.baixarXml(creds, chave),
    },
    emissao: {
      emitirNFCe: (input) => emissao.emitirNFCe(creds, input),
      consultarNFCe: () => emissao.consultarNFCe(),
      cancelarNFCe: (alvo, justificativa) => emissao.cancelarNFCe(creds, alvo.chave, alvo.protocolo, justificativa),
    },
  }
}
