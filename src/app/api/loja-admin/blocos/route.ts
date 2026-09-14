import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'
import { validarBloco } from '@/lib/commerce/validarBloco'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as { lojaId?: string } & Record<string, unknown> | null
  if (!corpo?.lojaId || !UUID.test(corpo.lojaId as string)) {
    return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  }
  if (!(await lojaDaSessao(ctx, corpo.lojaId as string))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }

  const resultado = validarBloco(corpo)
  if ('erro' in resultado) return NextResponse.json({ erro: resultado.erro }, { status: 400 })

  const { data, error } = await ctx.sb
    .from('loja_blocos_home')
    .insert({ empresa_id: ctx.empresaId, loja_id: corpo.lojaId, ...resultado.valores })
    .select('id').single()

  if (error) {
    console.error('[loja-admin] blocos/criar falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar' }, { status: 500 })
  }

  invalidarVitrine(corpo.lojaId as string)
  return NextResponse.json({ ok: true, id: data.id })
}
