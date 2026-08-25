import { NextResponse } from 'next/server'
import { contextoAdmin, invalidarVitrine, lojaDaSessao } from '@/lib/commerce/admin'

// Publicar ou atualizar UM produto na Loja Online, direto da listagem de
// Produtos do ERP.
//
// Existe separada de /api/loja-admin/publicar porque responde a outra
// pergunta. Aquela é a operação em massa da tela da loja ("marque 300 e
// publique"); esta é o atalho de quem está no cadastro do produto e quer
// resolver ali mesmo, sem trocar de tela.
//
// Duas ações, e a diferença importa:
//
//   publicar   → o produto entra na vitrine (ou volta, se estava pausado).
//   atualizar  → o produto JÁ está na vitrine e o operador acabou de mexer no
//                cadastro. Força a releitura de imagem, busca, marca,
//                categoria e disponibilidade, sem esperar os 15 minutos do
//                cron de manutenção.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACOES = new Set(['publicar', 'atualizar', 'pausar'])

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  // Empresa sem loja não é erro do usuário: é o estado normal de quem ainda
  // não criou uma. A tela usa esta resposta para orientar em vez de falhar.
  if (!ctx.lojaId) {
    return NextResponse.json(
      { erro: 'Esta empresa ainda não tem loja online', semLoja: true },
      { status: 409 },
    )
  }

  const corpo = await req.json().catch(() => null) as
    { produtoId?: string; acao?: string } | null

  const produtoId = corpo?.produtoId
  const acao = corpo?.acao ?? 'publicar'

  if (!produtoId || !UUID.test(produtoId)) {
    return NextResponse.json({ erro: 'Produto inválido' }, { status: 400 })
  }
  if (!ACOES.has(acao)) {
    return NextResponse.json({ erro: 'Ação desconhecida' }, { status: 400 })
  }
  // A RLS já barraria, mas em silêncio — "0 linhas afetadas" é
  // indistinguível de sucesso. A recusa aqui é explícita.
  if (!(await lojaDaSessao(ctx, ctx.lojaId))) {
    return NextResponse.json({ erro: 'Loja não encontrada' }, { status: 404 })
  }

  if (acao === 'atualizar') {
    const { data, error } = await ctx.sb.rpc('loja_sincronizar_produtos', {
      p_loja_id: ctx.lojaId, p_produto_ids: [produtoId],
    })
    if (error) {
      console.error('[loja-admin] sincronizar falhou', { produtoId, erro: error.message })
      return NextResponse.json({ erro: 'Não foi possível atualizar' }, { status: 500 })
    }
    if (Number(data ?? 0) === 0) {
      return NextResponse.json(
        { erro: 'Este produto ainda não está na loja' },
        { status: 409 },
      )
    }
    invalidarVitrine(ctx.lojaId)
    return NextResponse.json({ ok: true, acao, status: 'publicado' })
  }

  const status = acao === 'pausar' ? 'pausado' : 'publicado'

  // Mesma função da publicação em massa: ela é quem confere que o produto
  // pertence à empresa dona da loja, cria a linha se não existir, e já
  // recalcula o cache de estoque.
  const { data, error } = await ctx.sb.rpc('loja_publicar_produtos', {
    p_loja_id: ctx.lojaId, p_produto_ids: [produtoId], p_status: status, p_usuario: ctx.userId,
  })

  if (error) {
    console.error('[loja-admin] publicar da listagem falhou', { produtoId, erro: error.message })
    return NextResponse.json({ erro: 'Não foi possível publicar' }, { status: 500 })
  }
  if (Number(data ?? 0) === 0) {
    // O produto não é da empresa dona da loja, ou está inativo. A função do
    // banco filtra os dois casos — aqui só se explica o porquê.
    return NextResponse.json(
      { erro: 'Produto não pôde ser publicado: verifique se está ativo' },
      { status: 409 },
    )
  }

  invalidarVitrine(ctx.lojaId)
  return NextResponse.json({ ok: true, acao, status })
}
