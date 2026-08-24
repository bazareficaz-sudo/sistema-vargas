import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'

// Publicação em massa.
//
// A trava de posse fica AQUI, na rota, e não só na tela. É a mesma lição que
// o resto deste sistema já aprendeu (`exigirPermissao` em toda rota sensível,
// e a exclusão de pedido de compra travada na rota e não no botão): esconder
// o botão não impede ninguém de chamar o endereço.

export const dynamic = 'force-dynamic'

const STATUS_VALIDOS = new Set(['nao_publicado', 'rascunho', 'publicado', 'pausado'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as
    { lojaId?: string; produtoIds?: unknown; status?: string } | null
  if (!corpo) return NextResponse.json({ erro: 'Corpo inválido' }, { status: 400 })

  const { lojaId, status } = corpo
  if (!lojaId || !UUID.test(lojaId)) {
    return NextResponse.json({ erro: 'Loja inválida' }, { status: 400 })
  }
  if (!status || !STATUS_VALIDOS.has(status)) {
    return NextResponse.json({ erro: 'Estado inválido' }, { status: 400 })
  }

  // A loja é da empresa ativa desta sessão? A RLS já barraria, mas ela
  // barraria em silêncio — "0 linhas afetadas" é indistinguível de sucesso.
  if (!(await lojaDaSessao(ctx, lojaId))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }

  const ids = Array.isArray(corpo.produtoIds)
    ? corpo.produtoIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 5000)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ erro: 'Nenhum produto informado' }, { status: 400 })
  }

  // A função do banco também confere `p.empresa_id = empresa da loja`: id de
  // produto de outra empresa passado aqui simplesmente não entra.
  const { data, error } = await ctx.sb.rpc('loja_publicar_produtos', {
    p_loja_id: lojaId, p_produto_ids: ids, p_status: status, p_usuario: ctx.userId,
  })

  if (error) {
    console.error('[loja-admin] publicar falhou', { lojaId, erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar' }, { status: 500 })
  }

  invalidarVitrine(lojaId)
  return NextResponse.json({ ok: true, afetados: Number(data ?? 0) })
}
