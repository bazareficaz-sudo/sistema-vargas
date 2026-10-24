import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'
import { validarExperienciaFrete } from '@/lib/commerce/frete/validar'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Escolhas do gestor sobre COMO a loja pergunta o bairro ao cliente. Separada
// da configuração geral de propósito: salvar uma não reescreve a outra, e
// mexer na janela nunca toca em valor de frete.
export async function PUT(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  const lojaId = typeof corpo?.lojaId === 'string' ? corpo.lojaId : ''
  if (!corpo || !UUID.test(lojaId)) return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const r = validarExperienciaFrete(corpo)
  if ('erro' in r) return NextResponse.json({ erro: r.erro }, { status: 400 })

  const { error } = await ctx.sb
    .from('loja_frete_config')
    .upsert(
      { loja_id: lojaId, empresa_id: ctx.empresaId, updated_at: new Date().toISOString(), ...r.valores },
      { onConflict: 'loja_id' },
    )
  if (error) {
    console.error('[loja-admin] frete/experiencia falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar.' }, { status: 500 })
  }

  invalidarVitrine(lojaId)
  return NextResponse.json({ ok: true })
}
