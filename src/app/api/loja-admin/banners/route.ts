import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'
import { categoriaDaLoja, validarBanner } from '@/lib/commerce/validarBanner'

// CRUD de `loja_banners` — criar aqui, editar/excluir em `[id]/route.ts`.
//
// `posicao` NUNCA vem do cliente: fica travada em 'hero'. A tabela também
// aceita 'intermediario', mas nada no lado da vitrine lê essa posição hoje
// (ver src/lib/commerce/catalogo.ts) — deixar o cliente escolher criaria um
// banner que parece salvo e nunca aparece em lugar nenhum.

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

  const resultado = validarBanner(corpo)
  if ('erro' in resultado) return NextResponse.json({ erro: resultado.erro }, { status: 400 })

  // A posição é decisão EXPLÍCITA de quem chama, não inferida de a categoria
  // vir preenchida: se a tela de categoria mandasse a categoria vazia e a rota
  // caísse em 'hero', o banner da categoria apareceria no carrossel da home.
  const ehCategoria = corpo.posicao === 'categoria'
  let categoriaId: string | null = null
  if (ehCategoria) {
    const cat = await categoriaDaLoja(ctx.sb, corpo.lojaId as string, corpo.categoriaId)
    if ('erro' in cat) return NextResponse.json({ erro: cat.erro }, { status: 400 })
    categoriaId = cat.categoriaId
  }

  const { data, error } = await ctx.sb
    .from('loja_banners')
    .insert({
      empresa_id: ctx.empresaId, loja_id: corpo.lojaId,
      posicao: ehCategoria ? 'categoria' : 'hero', loja_categoria_id: categoriaId,
      ...resultado.valores,
    })
    .select('id').single()

  if (error) {
    console.error('[loja-admin] banners/criar falhou', { erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível salvar' }, { status: 500 })
  }

  invalidarVitrine(corpo.lojaId as string)
  return NextResponse.json({ ok: true, id: data.id })
}
