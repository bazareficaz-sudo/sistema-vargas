import type { DfeListaResultado, EmissaoNFCeInput, EmissaoNFCeResultado, TipoManifesto } from './types'

// Interface comum a qualquer provedor fiscal (Focus NFe, Brasil NFe, ...).
// Dividida por capacidade porque um provedor pode amadurecer uma parte antes
// da outra — hoje só distribuição existe de verdade; emissão é nova.
export interface FiscalProvider {
  nome: string

  distribuicao: {
    listarDfe(ultimoNsu: string): Promise<DfeListaResultado>
    manifestar(chave: string, tipo: TipoManifesto, justificativa?: string): Promise<void>
    baixarXml(chave: string): Promise<string>
  }

  emissao: {
    emitirNFCe(input: EmissaoNFCeInput): Promise<EmissaoNFCeResultado>
    consultarNFCe(referencia: string): Promise<EmissaoNFCeResultado>
    cancelarNFCe(referencia: string, justificativa: string): Promise<{ ok: boolean; erro?: string }>
  }
}
