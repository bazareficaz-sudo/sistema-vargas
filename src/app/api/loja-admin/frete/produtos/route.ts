import { NextResponse } from 'next/server'
import { contextoAdmin, lojaDaSessao } from '@/lib/commerce/admin'
import { validarProdutoFrete } from '@/lib/commerce/frete/validar'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Busca de produtos para marcar regra especial de frete.
// Usa a sessão do usuário: a RLS já limita a produtos da empresa ativa.
export async function GET(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 60)
  if (q.length < 2) return NextResponse.json({ produtos: [] })

  // `%`, `_` e vírgula têm sentido no filtro do PostgREST; sem escapar, uma
  // busca por "50%" ou "a,b" mudaria a consulta em vez de procurar o texto.
  const seguro = q.replace(/[%_,()\\]/g, ' ').trim()
  if (!seguro) return NextResponse.json({ produtos: [] })

  const { data, error } = await ctx.sb
    .from('produtos')
    .select('id, nome, sku, peso_kg')
    .eq('empresa_id', ctx.empresaId).eq('ativo', true)
    .ilike('nome', `%${seguro}%`)
    .order('nome').limit(15)

  if (error) {
    console.error('[loja-admin] frete/produtos buscar falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível buscar.' }, { status: 500 })
  }
  return NextResponse.json({ produtos: data ?? [] })
}

// Cria ou atualiza a regra especial de um produto.
export async function PUT(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null
  const lojaId = typeof corpo?.lojaId === 'string' ? corpo.lojaId : ''
  const produtoId = typeof corpo?.produtoId === 'string' ? corpo.produtoId : ''
  if (!corpo || !UUID.test(lojaId) || !UUID.test(produtoId)) {
    return NextResponse.json({ erro: 'Pedido inválido' }, { status: 400 })
  }
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  // O produto precisa ser da empresa da sessão: sem isto, um id alheio
  // entraria na tabela da loja.
  const { data: p } = await ctx.sb
    .from('produtos').select('id').eq('id', produtoId).eq('empresa_id', ctx.empresaId).maybeSingle()
  if (!p) return NextResponse.json({ erro: 'Produto não encontrado' }, { status: 404 })

  const r = validarProdutoFrete(corpo)
  if ('erro' in r) return NextResponse.json({ erro: r.erro }, { status: 400 })

  const { error } = await ctx.sb
    .from('loja_frete_produtos')
    .upsert(
      { loja_id: lojaId, produto_id: produtoId, empresa_id: ctx.empresaId, ...r.valores },
      { onConflict: 'loja_id,produto_id' },
    )
  if (error) {
    console.error('[loja-admin] frete/produtos salvar falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const u = new URL(req.url).searchParams
  const lojaId = u.get('lojaId') ?? ''
  const produtoId = u.get('produtoId') ?? ''
  if (!UUID.test(lojaId) || !UUID.test(produtoId)) return NextResponse.json({ erro: 'Pedido inválido' }, { status: 400 })
  if (!(await lojaDaSessao(ctx, lojaId))) return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })

  const { error } = await ctx.sb
    .from('loja_frete_produtos').delete().eq('loja_id', lojaId).eq('produto_id', produtoId)
  if (error) {
    console.error('[loja-admin] frete/produtos excluir falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível remover.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
