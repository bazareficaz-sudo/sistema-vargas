import { NextResponse } from 'next/server'
import { contextoAdmin, lojaDaSessao } from '@/lib/commerce/admin'
import { calcularFrete } from '@/lib/commerce/frete/calculo'
import { distanciaRetaKm, localizarCep } from '@/lib/commerce/frete/geo'
import { paraConfig, paraRegra } from '@/lib/commerce/frete/servico'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown, padrao: number) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : padrao
}

// Simulador do painel: roda o MESMO motor da vitrine sobre as regras SALVAS,
// com um pedido fictício. É como o lojista confere uma tabela de frete antes
// de ligá-la, sem fazer pedido de teste.
//
// Usa a configuração e as regras do banco mesmo com o frete desligado — o
// "ativo" só vale para a vitrine.
export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  const lojaId = typeof corpo?.lojaId === 'string' ? corpo.lojaId : ''
  if (!corpo || !UUID.test(lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const [{ data: c }, { data: rs }] = await Promise.all([
    ctx.sb.from('loja_frete_config').select('*').eq('loja_id', lojaId).maybeSingle(),
    ctx.sb.from('loja_frete_regras').select('*').eq('loja_id', lojaId),
  ])
  if (!c) return NextResponse.json({ erro: 'Salve a configuração do frete antes de simular.' }, { status: 400 })

  const config = paraConfig(c)
  const regras = ((rs ?? []) as Record<string, any>[]).map(paraRegra)

  const cep = txt(corpo.cep, 12)
  const endereco = cep.replace(/\D/g, '').length === 8 ? await localizarCep(cep) : null
  const bairro = txt(corpo.bairro, 100) || endereco?.bairro || null
  const cidade = txt(corpo.cidade, 100) || endereco?.cidade || null

  let distanciaKm: number | null = null
  if (c.origem_lat != null && c.origem_lng != null && endereco?.lat != null && endereco.lng != null) {
    const reta = distanciaRetaKm(
      { lat: Number(c.origem_lat), lng: Number(c.origem_lng) },
      { lat: endereco.lat, lng: endereco.lng },
    )
    distanciaKm = Math.round(reta * config.fatorEstrada * 10) / 10
  } else if (corpo.distanciaKm != null && corpo.distanciaKm !== '') {
    // Distância digitada: permite testar a tabela sem depender de CEP.
    distanciaKm = num(corpo.distanciaKm, 0)
  }

  const subtotal = num(corpo.subtotal, 100)
  const pesoKg = num(corpo.pesoKg, 1)

  const resultado = calcularFrete(
    config, regras,
    [{ produtoId: 'simulacao', nome: 'Pedido de teste', quantidade: 1, pesoKg, precoUnitario: subtotal }],
    { cep: cep || null, bairro, cidade, uf: endereco?.uf ?? null, distanciaKm },
  )

  return NextResponse.json({
    ok: true,
    resultado,
    distanciaKm,
    endereco: endereco && { bairro: endereco.bairro, cidade: endereco.cidade, uf: endereco.uf },
    semOrigem: c.origem_lat == null || c.origem_lng == null,
  })
}
