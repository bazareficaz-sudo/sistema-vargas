import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const cnpj = req.nextUrl.searchParams.get('cnpj')?.replace(/\D/g, '')
  if (!cnpj || cnpj.length !== 14)
    return NextResponse.json({ error: 'CNPJ inválido' }, { status: 400 })

  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 86400 },
    })
    if (!res.ok) return NextResponse.json({ error: 'CNPJ não encontrado' }, { status: 404 })
    const data = await res.json()
    return NextResponse.json({
      razaoSocial: data.razao_social ?? '',
      nomeFantasia: data.nome_fantasia ?? '',
      logradouro: data.logradouro ?? '',
      numero: data.numero ?? '',
      bairro: data.bairro ?? '',
      municipio: data.municipio ?? '',
      uf: data.uf ?? '',
      cep: data.cep ?? '',
      situacao: data.descricao_situacao_cadastral ?? '',
    })
  } catch {
    return NextResponse.json({ error: 'Erro ao consultar CNPJ' }, { status: 500 })
  }
}
