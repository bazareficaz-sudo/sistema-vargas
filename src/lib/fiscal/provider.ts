import type { DfeListaResultado, EmissaoNFCeInput, EmissaoNFCeResultado, TipoManifesto } from './types'

// Interface comum a qualquer provedor fiscal (Focus NFe, Brasil NFe, ...).
// Dividida por capacidade porque um provedor pode amadurecer uma parte antes
// da outra — hoje só distribuição existe de verdade; emissão é nova.
export interface FiscalProvider {
  nome: string

  distribuicao: {
    // periodoDias: janela de busca em dias (usado pela Brasil NFe, que
    // consulta por período em vez de paginar por versão/NSU como a Focus
    // — a Focus ignora esse parâmetro). Undefined = janela padrão do
    // provider.
    listarDfe(cnpj: string, ultimaVersao: string, periodoDias?: number): Promise<DfeListaResultado>
    manifestar(chave: string, tipo: TipoManifesto, justificativa?: string): Promise<void>
    baixarXml(chave: string): Promise<string>
  }

  emissao: {
    emitirNFCe(input: EmissaoNFCeInput): Promise<EmissaoNFCeResultado>
    consultarNFCe(referencia: string): Promise<EmissaoNFCeResultado>
    // referencia = nosso id (usado pela Focus, que identifica a nota pela
    // referência que você mandou na emissão); chave/protocolo = usados pela
    // Brasil NFe, que pede a chave de acesso e o número de protocolo da
    // SEFAZ direto no payload de cancelamento, não uma referência nossa.
    // Cada provider usa só o que precisa.
    cancelarNFCe(alvo: { referencia: string; chave?: string; protocolo?: string }, justificativa: string): Promise<{ ok: boolean; erro?: string }>
  }
}
