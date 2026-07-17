import type { FiscalProvider } from '../provider'

// Stub — por decisão explícita do usuário, sem documentação/credenciais de
// teste da Brasil NFe em mãos ainda. Implementação real fica pra quando
// houver isso, evitando inventar endpoints/payloads sem fonte confiável
// (mesmo princípio já aplicado às outras integrações desta sessão).
function naoImplementado(): never {
  throw new Error('BrasilNFeProvider ainda não implementado — aguardando documentação/credenciais de teste da Brasil NFe')
}

export function createBrasilNFeProvider(): FiscalProvider {
  return {
    nome: 'brasilnfe',
    distribuicao: {
      listarDfe: async () => naoImplementado(),
      manifestar: async () => naoImplementado(),
      baixarXml: async () => naoImplementado(),
    },
    emissao: {
      emitirNFCe: async () => naoImplementado(),
      consultarNFCe: async () => naoImplementado(),
      cancelarNFCe: async () => naoImplementado(),
    },
  }
}
