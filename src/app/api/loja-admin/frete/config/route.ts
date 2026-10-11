import { NextResponse } from 'next/server'
import { contextoAdmin, lojaDaSessao } from '@/lib/commerce/admin'
import { validarConfigFrete } from '@/lib/commerce/frete/validar'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Grava a configuração geral do frete (uma linha por loja).
export async function PUT(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  const lojaId = typeof corpo?.lojaId === 'string' ? corpo.lojaId : ''
  if (!corpo || !UUID.test(lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const r = validarConfigFrete(corpo)
  if ('erro' in r) return NextResponse.json({ erro: r.erro }, { status: 400 })

  const { error } = await ctx.sb
    .from('loja_frete_config')
    .upsert(
      { loja_id: lojaId, empresa_id: ctx.empresaId, updated_at: new Date().toISOString(), ...r.valores },
      { onConflict: 'loja_id' },
    )

  if (error) {
    console.error('[loja-admin] frete/config falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar. A migração do frete já foi aplicada?' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
