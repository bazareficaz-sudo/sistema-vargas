import type { FiscalProvider } from '../provider'
import type { FocusCredentials } from './client'
import * as distribuicao from './distribuicao'
import * as emissao from './emissao'

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
      consultarNFCe: (referencia) => emissao.consultarNFCe(creds, referencia),
      cancelarNFCe: (alvo, justificativa) => emissao.cancelarNFCe(creds, alvo.referencia, justificativa),
    },
  }
}
