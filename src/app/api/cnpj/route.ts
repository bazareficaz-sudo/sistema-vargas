import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const APIS = [
  (cnpj: string) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
  (cnpj: string) => `https://publica.cnpj.ws/cnpj/${cnpj}`,
]

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function parseBrasilAPI(data: Record<string, string>) {
  return {
    razaoSocial: data.razao_social ?? '',
    nomeFantasia: data.nome_fantasia ?? '',
    logradouro: data.logradouro ?? '',
    numero: data.numero ?? '',
    bairro: data.bairro ?? '',
    municipio: data.municipio ?? '',
    uf: data.uf ?? '',
    cep: data.cep ?? '',
    situacao: data.descricao_situacao_cadastral ?? '',
  }
}

function parseCnpjWs(data: Record<string, unknown>) {
  const end = (data.estabelecimento as Record<string, unknown>) ?? {}
  const mun = (end.cidade as Record<string, string>) ?? {}
  const est = (end.estado as Record<string, string>) ?? {}
  return {
    razaoSocial: (data.razao_social as string) ?? '',
    nomeFantasia: (end.nome_fantasia as string) ?? '',
    logradouro: (end.logradouro as string) ?? '',
    numero: (end.numero as string) ?? '',
    bairro: (end.bairro as string) ?? '',
    municipio: mun.nome ?? '',
    uf: est.sigla ?? '',
    cep: ((end.cep as string) ?? '').replace(/\D/g, ''),
    situacao: (end.situacao_cadastral as string) ?? '',
  }
}

export async function GET(req: NextRequest) {
  const cnpj = req.nextUrl.searchParams.get('cnpj')?.replace(/\D/g, '')
  if (!cnpj || cnpj.length !== 14)
    return NextResponse.json({ error: 'CNPJ deve ter 14 dígitos' }, { status: 400 })

  // Tenta BrasilAPI primeiro, depois cnpj.ws como fallback
  for (let i = 0; i < APIS.length; i++) {
    const url = APIS[i](cnpj)
    try {
      const res = await fetchWithTimeout(url, 8000)
      if (!res.ok) {
        if (i === APIS.length - 1)
          return NextResponse.json({ error: 'CNPJ não encontrado na Receita Federal' }, { status: 404 })
        continue
      }
      const data = await res.json()
      const parsed = i === 0 ? parseBrasilAPI(data) : parseCnpjWs(data)
      return NextResponse.json(parsed)
    } catch {
      if (i === APIS.length - 1)
        return NextResponse.json({ error: 'Serviço de consulta CNPJ indisponível. Preencha manualmente.' }, { status: 503 })
    }
  }

  return NextResponse.json({ error: 'Erro inesperado' }, { status: 500 })
}
