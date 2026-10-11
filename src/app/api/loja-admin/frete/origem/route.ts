import { NextResponse } from 'next/server'
import { contextoAdmin, lojaDaSessao } from '@/lib/commerce/admin'
import { localizarEndereco } from '@/lib/commerce/frete/geo'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Descobre a coordenada da loja a partir do endereço cadastrado em
// Configurações. Não grava: devolve para o painel preencher os campos, e o
// lojista confere antes de salvar — coordenada errada estraga TODA distância.
export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as { lojaId?: string } | null
  if (!corpo?.lojaId || !UUID.test(corpo.lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, corpo.lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const { data: l } = await ctx.sb
    .from('loja_config').select('cep, logradouro, bairro, cidade, uf').eq('id', corpo.lojaId).single()

  if (!l?.cep && !(l?.cidade && l?.uf)) {
    return NextResponse.json(
      { erro: 'Preencha o CEP (ou cidade e UF) do endereço da loja em Configurações primeiro.' },
      { status: 400 },
    )
  }

  const c = await localizarEndereco(l)
  if (!c) {
    return NextResponse.json(
      { erro: 'Não foi possível localizar o endereço da loja. Informe latitude e longitude à mão.' },
      { status: 404 },
    )
  }
  return NextResponse.json({ ok: true, lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 })
}
