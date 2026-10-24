import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'
import { validarRegraFrete } from '@/lib/commerce/frete/validar'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Cria uma regra de frete. Edição e exclusão ficam em `[id]/route.ts`.
export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  const lojaId = typeof corpo?.lojaId === 'string' ? corpo.lojaId : ''
  if (!corpo || !UUID.test(lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const r = validarRegraFrete(corpo)
  if ('erro' in r) return NextResponse.json({ erro: r.erro }, { status: 400 })

  const { data, error } = await ctx.sb
    .from('loja_frete_regras')
    .insert({ empresa_id: ctx.empresaId, loja_id: lojaId, ...r.valores })
    .select('id').single()

  if (error) {
    console.error('[loja-admin] frete/regras criar falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar a regra.' }, { status: 500 })
  }
  invalidarVitrine(lojaId)
  return NextResponse.json({ ok: true, id: data.id })
}
