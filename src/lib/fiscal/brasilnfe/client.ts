import { FiscalProviderError } from '../types'

// Confiança moderada: diferente da Focus (doc pública com OpenAPI), a doc
// da Brasil NFe (brasilnfe.com.br/docs) é uma página em prosa que precisou
// ser interpretada, e trechos ficaram inconsistentes entre si (formato de
// TipoAmbiente ora string ora número, código de Pix divergente entre
// páginas). O que está aqui foi cruzado contra o SDK PHP oficial deles no
// GitHub (BrasilNFe/brasilnfe-php-sdk — código de verdade, não prosa),
// que resolveu as inconsistências, mas ainda vale testar em homologação
// antes de confiar em produção.

const BASE_URL = 'https://api.brasilnfe.com.br'

export type BrasilNFeCredentials = { token: string; userToken?: string; ambiente: 'producao' | 'homologacao' }

// Confirmado pelo SDK PHP: tipoAmbiente = 1 (produção) | 2 (homologação).
export function tipoAmbiente(ambiente: 'producao' | 'homologacao'): number {
  return ambiente === 'homologacao' ? 2 : 1
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function brasilNFeRequest(
  creds: BrasilNFeCredentials,
  path: string,
  body: any
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = {
    'Token': creds.token,
    'Content-Type': 'application/json',
  }
  if (creds.userToken) headers['UserToken'] = creds.userToken

  let resp: Response
  try {
    resp = await fetchWithTimeout(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (e: any) {
    const timeout = e?.name === 'AbortError'
    throw new FiscalProviderError(
      timeout ? 'Tempo esgotado ao conectar com a Brasil NFe' : `Erro de rede ao conectar com a Brasil NFe: ${e?.message ?? e}`,
      timeout ? 'timeout' : 'rede'
    )
  }

  const text = await resp.text()
  return { status: resp.status, text }
}
