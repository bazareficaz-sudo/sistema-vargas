import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const c = await req.json().catch(() => null) as
    { lojaId?: string; acao?: string; id?: string; nome?: string; valor?: boolean } | null
  if (!c?.lojaId || !UUID.test(c.lojaId)) {
    return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  }
  if (!(await lojaDaSessao(ctx, c.lojaId))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }

  switch (c.acao) {
    case 'semear': {
      const { data, error } = await ctx.sb.rpc('loja_semear_categorias', { p_loja_id: c.lojaId })
      if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
      // Semear cria os nós; reindexar é o que faz os produtos caírem neles.
      // Separado na função, junto aqui: para o operador é UMA ação.
      await ctx.sb.rpc('loja_reindexar', { p_loja_id: c.lojaId })
      invalidarVitrine(c.lojaId)
      return NextResponse.json({ ok: true, criadas: Number(data ?? 0) })
    }

    case 'reindexar': {
      const { error } = await ctx.sb.rpc('loja_reindexar', { p_loja_id: c.lojaId })
      if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
      invalidarVitrine(c.lojaId)
      return NextResponse.json({ ok: true })
    }

    case 'renomear': {
      const nome = (c.nome ?? '').trim().slice(0, 120)
      if (!c.id || !UUID.test(c.id) || !nome) {
        return NextResponse.json({ erro: 'Nome inválido' }, { status: 400 })
      }
      // O SLUG NÃO MUDA junto com o nome, de propósito. Slug que muda quebra
      // todo link já compartilhado e derruba a posição no Google — e o nome é
      // justamente o campo que o lojista vai ajustar várias vezes.
      const { error } = await ctx.sb
        .from('loja_categorias').update({ nome })
        .eq('id', c.id).eq('loja_id', c.lojaId).eq('empresa_id', ctx.empresaId)
      if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
      invalidarVitrine(c.lojaId)
      return NextResponse.json({ ok: true })
    }

    case 'alternar_ativo': {
      if (!c.id || !UUID.test(c.id)) return NextResponse.json({ erro: 'Categoria inválida' }, { status: 400 })
      const { error } = await ctx.sb
        .from('loja_categorias').update({ ativo: !!c.valor })
        .eq('id', c.id).eq('loja_id', c.lojaId).eq('empresa_id', ctx.empresaId)
      if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
      invalidarVitrine(c.lojaId)
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ erro: 'Ação desconhecida' }, { status: 400 })
  }
}
