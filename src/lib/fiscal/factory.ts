import type { FiscalProvider } from './provider'
import { createFocusNFeProvider } from './focusnfe/provider'
import { createBrasilNFeProvider } from './brasilnfe/provider'
import { FiscalProviderError } from './types'

// Resolve o provider fiscal configurado pela empresa (nfe_config.provider)
// e monta as credenciais certas pro ambiente ativo. `credenciais` (JSONB
// { token_homologacao, token_producao }) é o formato novo; se estiver vazio,
// cai pro campo legado `focusnfe_token` (configurações feitas antes desta
// camada existir continuam funcionando sem precisar recadastrar o token).
export async function getFiscalProvider(sb: any, empresaId: string): Promise<FiscalProvider> {
  const { data: config } = await sb
    .from('nfe_config')
    .select('provider, credenciais, focusnfe_token, ambiente')
    .eq('empresa_id', empresaId)
    .single()

  const provider = config?.provider ?? 'focusnfe'
  const ambiente: 'producao' | 'homologacao' = config?.ambiente === 'homologacao' ? 'homologacao' : 'producao'

  // Mesma resolução de token pros dois provedores — ambos autenticam com um
  // único token por ambiente, então o campo `credenciais` (JSONB) é
  // reaproveitado igual, independente de qual provider está ativo.
  const credenciais = config?.credenciais ?? {}
  const token = ambiente === 'homologacao'
    ? (credenciais.token_homologacao || config?.focusnfe_token)
    : (credenciais.token_producao || config?.focusnfe_token)

  const nomeProvider = provider === 'brasilnfe' ? 'Brasil NFe' : 'Focus NFe'
  if (!token) {
    throw new FiscalProviderError(
      `Token da ${nomeProvider} não configurado. Configure em Empresas > [sua empresa] > aba Fiscal.`,
      'sem_credenciais'
    )
  }

  if (provider === 'brasilnfe') return createBrasilNFeProvider({ token, ambiente })
  return createFocusNFeProvider({ token, ambiente })
}
