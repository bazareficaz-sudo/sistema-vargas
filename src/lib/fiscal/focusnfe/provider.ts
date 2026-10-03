import type { FiscalProvider } from '../provider'
import type { FocusCredentials } from './client'
import * as distribuicao from './distribuicao'
import * as emissao from './emissao'
import { FiscalProviderError } from '../types'

export function createFocusNFeProvider(creds: FocusCredentials): FiscalProvider {
  return {
    nome: 'focusnfe',
    distribuicao: {
      listarDfe: (cnpj, ultimaVersao) => distribuicao.listarDfe(creds, cnpj, ultimaVersao),
      manifestar: (chave, tipo, justificativa) => distribuicao.manifestar(creds, chave, tipo, justificativa),
      baixarXml: (chave) => distribuicao.baixarXml(creds, chave),
    },
    emissao: {
      emitirNFCe: (input) => emissao.emitirNFCe(creds, input),
      // As duas empresas do grupo emitem pela Brasil NFe; a NF-e pela Focus
      // não foi construída. Falha com o motivo, em vez de mandar uma NFC-e.
      emitirNFe: async () => {
        throw new FiscalProviderError('Emissão de NF-e (modelo 55) ainda não disponível para a Focus NFe — só para a Brasil NFe.', 'nao_suportado')
      },
      consultarNFCe: (referencia) => emissao.consultarNFCe(creds, referencia),
      cancelarNFCe: (alvo, justificativa) => emissao.cancelarNFCe(creds, alvo.referencia, justificativa),
    },
  }
}
