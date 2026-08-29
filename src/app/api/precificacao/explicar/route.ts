import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { criarResolvedor, descreverOrigem, COLUNAS_ANUNCIO, COLUNAS_CANAL, COLUNAS_PRODUTO } from '@/lib/precificacao/contexto'
import { precificarPorRegra } from '@/lib/precificacao/cenarios'
import { montarEstrategia } from '@/lib/precificacao/estrategia'
import { buscarRegras, descreverObjetivo, resolverRegra } from '@/lib/precificacao/regras'

// "Por que este anúncio está com esse preço?"
//
// Devolve, por canal: qual regra venceu e por quê, quais perderam e por quê,
// de onde vieram as taxas, a conta completa e a diferença para o preço que
// está no ar hoje. É o antídoto contra preço que ninguém sabe explicar.
//
// FASE 1: a economia passou a vir de `contexto.ts`, igual ao simulador e ao
// recálculo. Antes esta rota não consultava nem a comissão nem o frete reais
// do Mercado Livre, então explicava um preço que nenhuma outra tela produzia.
//
// FASE 2: passou a responder também "por que esta CLASSIFICAÇÃO comercial?".
// Um preço explicado sem a política ao lado não diz se ele pode ser
// executado — e é essa a pergunta que a automação futura vai fazer.

export const maxDuration = 60

export async function POST(req: Request) {
  const { produtoId, canaisIds } = await req.json() as { produtoId: string; canaisIds?: string[] }
  if (!produtoId) return NextResponse.json({ ok: false, erro: 'Produto não informado' }, { status: 400 })

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: produto } = await sb.from('produtos').select(COLUNAS_PRODUTO)
    .eq('id', produtoId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!produto) return NextResponse.json({ ok: false, erro: 'Produto não encontrado' }, { status: 404 })

  let query = sb.from('marketplace_canais').select(COLUNAS_CANAL).eq('empresa_id', guarda.empresaId)
  if (canaisIds?.length) query = query.in('id', canaisIds)
  const { data: canais } = await query.order('nome')
  if (!canais?.length) return NextResponse.json({ ok: false, erro: 'Nenhum canal encontrado' }, { status: 404 })

  const regras = await buscarRegras(sb, guarda.empresaId)

  // Preço que está no ar hoje, por canal — pra mostrar a diferença entre o
  // que a regra manda e o que o anúncio realmente cobra.
  const { data: anuncios } = await sb.from('marketplace_anuncios').select(COLUNAS_ANUNCIO)
    .eq('produto_id', produtoId).eq('empresa_id', guarda.empresaId)
  const anuncioPorCanal = new Map((anuncios ?? []).map((a: any) => [a.canal_id, a]))

  const resolvedor = criarResolvedor(sb, guarda.empresaId)
  const resultados = []
  let custo = 0

  for (const canal of canais) {
    const anuncio = anuncioPorCanal.get(canal.id) ?? null
    const ctx = await resolvedor.contexto({ canal, produto, anuncio })
    custo = ctx.economia.custo

    if (!(custo > 0)) {
      return NextResponse.json({
        ok: false,
        erro: `O produto "${produto.nome}" não tem custo cadastrado — sem custo não dá para calcular preço nenhum.`,
      }, { status: 400 })
    }

    const resolucao = resolverRegra(regras, { id: produto.id, categoria: produto.categoria, marca: produto.marca }, canal)

    if (!resolucao.vencedora) {
      resultados.push({
        canal: { id: canal.id, nome: canal.nome, plataforma: canal.plataforma },
        origemConfig: ctx.origemConfig, semRegra: true,
        explicacao: 'Nenhuma regra de precificação se aplica a este produto neste canal. Crie ao menos uma regra geral da empresa para ter um preço calculado.',
        anuncioAtual: anuncio,
        precos: ctx.precos,
      })
      continue
    }

    // O preço da regra é calculado SEMPRE — inclusive para produto que ainda
    // não tem anúncio neste canal, que é justamente quem mais precisa da
    // resposta "por quanto eu deveria vender aqui?".
    const cenario = precificarPorRegra(ctx.economia, resolucao.vencedora)
    const precoAtual = ctx.precos?.efetivo ?? null

    // A leitura comercial só existe quando há preço no ar para classificar.
    // Sem anúncio não há preço efetivo, e inventar um zero faria a política
    // acusar "abaixo do piso" num produto que simplesmente não está à venda.
    const estrategia = ctx.precos && ctx.precos.efetivo > 0
      ? montarEstrategia({ economia: ctx.economia, precos: ctx.precos, regra: resolucao.vencedora, agora: ctx.resolvidoEm })
      : null
    const hoje = estrategia?.cenarioEfetivo ?? null

    resultados.push({
      canal: { id: canal.id, nome: canal.nome, plataforma: canal.plataforma },
      origemConfig: ctx.origemConfig,
      origemComissao: ctx.origemComissao,
      origemFrete: ctx.origemFrete,
      origem: descreverOrigem(ctx),
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
      resultado: { ...cenario.resultado, avisos: [...cenario.resultado.avisos, ...ctx.avisos] },
      regime: cenario.resultado.regime,
      saude: cenario.saude,
      anuncioAtual: anuncio,
      precos: ctx.precos,
      precoAtual,
      hoje: hoje ? { resultado: hoje.resultado, saude: hoje.saude } : null,
      diferenca: precoAtual != null ? Number((cenario.resultado.preco - precoAtual).toFixed(2)) : null,

      // ── Leitura comercial ──
      comercial: estrategia ? {
        precoBase: estrategia.precoBase,
        precoEfetivo: estrategia.precoEfetivo,
        origemEfetivo: estrategia.origemEfetivo,
        origemBase: estrategia.origemBase,
        margemEfetiva: estrategia.margemEfetiva,
        margens: estrategia.margens,
        precoAlvo: estrategia.precoAlvo,
        precoPromocionalLimite: estrategia.precoPromocionalLimite,
        precoPiso: estrategia.precoPiso,
        classificacao: estrategia.classificacao.classificacao,
        motivo: estrategia.classificacao.motivo,
        distanciaDoAlvo: estrategia.classificacao.distanciaDoAlvo,
        estado: estrategia.estado,
        flags: estrategia.flags,
        campanha: estrategia.campanha,
        validadeAte: estrategia.validadeAte,
        oportunidades: estrategia.oportunidades,
      } : null,
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
