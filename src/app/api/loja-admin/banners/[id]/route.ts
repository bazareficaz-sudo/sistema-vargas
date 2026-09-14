import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'
import { validarBanner } from '@/lib/commerce/validarBanner'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ erro: 'Banner inválido' }, { status: 400 })

  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as { lojaId?: string } & Record<string, unknown> | null
  if (!corpo?.lojaId || !UUID.test(corpo.lojaId as string)) {
    return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  }
  if (!(await lojaDaSessao(ctx, corpo.lojaId as string))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }

  const resultado = validarBanner(corpo)
  if ('erro' in resultado) return NextResponse.json({ erro: resultado.erro }, { status: 400 })

  // `loja_id` no WHERE, não só no `id`: sem isso, um id de banner de outra
  // loja (adivinhado ou de outra aba aberta) seria editável por quem não é
  // dono dela — a mesma trava que toda rota de escrita da Loja Online usa.
  const { error } = await ctx.sb
    .from('loja_banners').update(resultado.valores)
    .eq('id', id).eq('loja_id', corpo.lojaId)

  if (error) {
    console.error('[loja-admin] banners/editar falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar' }, { status: 500 })
  }

  invalidarVitrine(corpo.lojaId as string)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ erro: 'Banner inválido' }, { status: 400 })

  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const url = new URL(req.url)
  const lojaId = url.searchParams.get('lojaId') ?? ''
  if (!UUID.test(lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const { error } = await ctx.sb.from('loja_banners').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) {
    console.error('[loja-admin] banners/excluir falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível excluir' }, { status: 500 })
  }

  invalidarVitrine(lojaId)
  return NextResponse.json({ ok: true })
}
