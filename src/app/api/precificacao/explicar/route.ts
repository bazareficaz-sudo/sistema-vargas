import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { buscarConfigDoCanal } from '@/lib/precificacao/config'
import { saudeDaMargem } from '@/lib/precificacao/motor'
import { aplicarRegra, buscarRegras, descreverObjetivo, resolverRegra } from '@/lib/precificacao/regras'
import { calcularKit } from '@/lib/produtos/kit'

// "Por que este anúncio está com esse preço?"
//
// Devolve, por canal: qual regra venceu e por quê, quais perderam e por quê,
// de onde vieram as taxas, a conta completa e a diferença para o preço que
// está no ar hoje. É o antídoto contra preço que ninguém sabe explicar.

export const maxDuration = 60

export async function POST(req: Request) {
  const { produtoId, canaisIds } = await req.json() as { produtoId: string; canaisIds?: string[] }
  if (!produtoId) return NextResponse.json({ ok: false, erro: 'Produto não informado' }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: produto } = await sb.from('produtos')
    .select('id, nome, sku, categoria, marca, tipo, preco_custo, preco_venda, peso_kg')
    .eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  const custo = produto.tipo === 'kit'
    ? Number((await calcularKit(sb, produto.id))?.custo ?? 0)
    : Number(produto.preco_custo ?? 0)
  if (!(custo > 0)) {
    return NextResponse.json({
      ok: false,
      erro: `O produto "${produto.nome}" não tem custo cadastrado — sem custo não dá para calcular preço nenhum.`,
    }, { status: 400 })
  }

  let query = sb.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', guarda.empresaId)
  if (canaisIds?.length) query = query.in('id', canaisIds)
  const { data: canais } = await query.order('nome')
  if (!canais?.length) return NextResponse.json({ ok: false, erro: 'Nenhum canal encontrado' }, { status: 404 })

  const regras = await buscarRegras(sb, guarda.empresaId)

  // Preço que está no ar hoje, por canal — pra mostrar a diferença entre o
  // que a regra manda e o que o anúncio realmente cobra.
  const { data: anuncios } = await sb.from('marketplace_anuncios')
    .select('id, canal_id, preco_venda, preco_promocional, titulo')
    .eq('produto_id', produtoId).eq('empresa_id', guarda.empresaId)
  const anuncioPorCanal = new Map((anuncios ?? []).map((a: any) => [a.canal_id, a]))

  const resultados = []
  for (const canal of canais) {
    const { cfg, origem } = await buscarConfigDoCanal(sb, guarda.empresaId, canal)
    const resolucao = resolverRegra(regras, { id: produto.id, categoria: produto.categoria, marca: produto.marca }, canal)

    if (!resolucao.vencedora) {
      resultados.push({
        canal, origemConfig: origem, semRegra: true,
        explicacao: 'Nenhuma regra de precificação se aplica a este produto neste canal. Crie ao menos uma regra geral da empresa para ter um preço calculado.',
        anuncioAtual: anuncioPorCanal.get(canal.id) ?? null,
      })
      continue
    }

    const r = aplicarRegra({ cfg, custoProduto: custo, regra: resolucao.vencedora, pesoKg: produto.peso_kg != null ? Number(produto.peso_kg) : null })
    if (origem === 'preset') {
      r.avisos.push('As taxas deste canal ainda não foram configuradas — o cálculo usa valores de partida.')
    }

    const atual = anuncioPorCanal.get(canal.id) ?? null
    const precoAtual = atual ? Number(atual.preco_promocional || atual.preco_venda || 0) : null

    resultados.push({
      canal,
      origemConfig: origem,
      semRegra: false,
      regra: {
        ...resolucao.vencedora,
        descricao: descreverObjetivo(resolucao.vencedora.objetivoTipo, resolucao.vencedora.objetivoValor),
      },
      porQue: resolucao.candidatas[0]?.motivo ?? '',
      perdedoras: resolucao.candidatas.slice(1).map(c => ({
        nome: c.regra.nome, nivel: c.regra.nivel, motivo: c.motivo,
        objetivo: descreverObjetivo(c.regra.objetivoTipo, c.regra.objetivoValor),
      })),
      resultado: r,
      saude: saudeDaMargem(r.margemLiquida, cfg.faixasSaude),
      anuncioAtual: atual,
      precoAtual,
      diferenca: precoAtual != null ? Number((r.preco - precoAtual).toFixed(2)) : null,
    })
  }

  return NextResponse.json({
    ok: true,
    produto: { id: produto.id, nome: produto.nome, sku: produto.sku, categoria: produto.categoria, marca: produto.marca, precoVenda: produto.preco_venda },
    custo,
    totalRegras: regras.length,
    resultados,
  })
}
