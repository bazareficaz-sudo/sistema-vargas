import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const c = await req.json().catch(() => null) as
    {
      lojaId?: string; acao?: string; id?: string; nome?: string; valor?: boolean
      arvore?: { id?: string; paiId?: string | null; ordem?: number }[]
    } | null
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

    case 'reordenar': {
      // A tela manda a ÁRVORE INTEIRA que quer, e não "mova X para Y".
      // Arrastar três categorias e salvar não pode deixar a árvore pela
      // metade se a quarta linha falhar — por isso a gravação inteira é uma
      // transação só, dentro de `loja_categorias_reordenar`.
      const itens = (c.arvore ?? [])
        .filter(i => i.id && UUID.test(i.id))
        .map((i, n) => ({
          id: i.id,
          // String vazia e `null` significam a mesma coisa aqui — raiz — e a
          // função do banco trata as duas.
          paiId: i.paiId && UUID.test(i.paiId) ? i.paiId : null,
          // A ordem vem da POSIÇÃO na lista, não do que o cliente mandou:
          // é o que impede uma tela desatualizada gravar índices repetidos.
          ordem: typeof i.ordem === 'number' ? i.ordem : n,
        }))

      if (itens.length === 0) {
        return NextResponse.json({ erro: 'Nada para salvar' }, { status: 400 })
      }
      // Teto defensivo: a árvore inteira vem numa requisição, e uma lista sem
      // limite vindo do navegador é entrada do usuário como qualquer outra.
      if (itens.length > 500) {
        return NextResponse.json({ erro: 'Categorias demais numa vez só' }, { status: 400 })
      }

      const { data, error } = await ctx.sb.rpc('loja_categorias_reordenar', {
        p_loja_id: c.lojaId, p_itens: itens,
      })
      if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

      const r = (data ?? {}) as Record<string, unknown>
      if (!r.ok) {
        const MOTIVO: Record<string, string> = {
          profundidade_maxima: 'A vitrine mostra dois níveis: categoria e subcategoria. Uma subcategoria não pode ter outra dentro.',
          categoria_dentro_de_si: 'Uma categoria não pode ficar dentro dela mesma.',
          categoria_de_outra_loja: 'Categoria não encontrada nesta loja.',
          pai_de_outra_loja: 'Categoria de destino não encontrada nesta loja.',
          nada_para_salvar: 'Nada para salvar.',
        }
        return NextResponse.json(
          { erro: MOTIVO[String(r.erro)] ?? 'Não foi possível salvar a ordem.' },
          { status: 400 },
        )
      }

      invalidarVitrine(c.lojaId)
      return NextResponse.json({ ok: true, atualizadas: r.atualizadas })
    }

    default:
      return NextResponse.json({ erro: 'Ação desconhecida' }, { status: 400 })
  }
}
