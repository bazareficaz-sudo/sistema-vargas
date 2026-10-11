import { NextResponse } from 'next/server'
import { contextoAdmin, lojaDaSessao } from '@/lib/commerce/admin'
import { validarRegraFrete } from '@/lib/commerce/frete/validar'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  if (!UUID.test(id)) return NextResponse.json({ erro: 'Regra inválida' }, { status: 400 })

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  const lojaId = typeof corpo?.lojaId === 'string' ? corpo.lojaId : ''
  if (!corpo || !UUID.test(lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const r = validarRegraFrete(corpo)
  if ('erro' in r) return NextResponse.json({ erro: r.erro }, { status: 400 })

  // `.select()` para distinguir "salvou" de "0 linhas" (regra de outra loja).
  const { data, error } = await ctx.sb
    .from('loja_frete_regras')
    .update({ ...r.valores, updated_at: new Date().toISOString() })
    .eq('id', id).eq('loja_id', lojaId)
    .select('id')

  if (error) {
    console.error('[loja-admin] frete/regras editar falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar a regra.' }, { status: 500 })
  }
  if (!data?.length) return NextResponse.json({ erro: 'Regra não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const lojaId = new URL(req.url).searchParams.get('lojaId') ?? ''
  if (!UUID.test(id) || !UUID.test(lojaId)) return NextResponse.json({ erro: 'Pedido inválido' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const { error } = await ctx.sb.from('loja_frete_regras').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) {
    console.error('[loja-admin] frete/regras excluir falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível excluir.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
