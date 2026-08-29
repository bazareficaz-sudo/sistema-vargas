import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { criarResolvedor, descreverOrigem, COLUNAS_ANUNCIO, COLUNAS_CANAL, COLUNAS_PRODUTO } from '@/lib/precificacao/contexto'
import { avaliarPreco, precificarPorObjetivo } from '@/lib/precificacao/cenarios'

// Recalcula UM anúncio da prévia com uma margem diferente da que a regra
// manda — ou avalia um preço que o operador informou.
//
// Existe porque nem todo produto suporta a margem da regra: a regra da
// categoria pede 20%, mas naquele item o mercado só deixa 15%. Em vez de
// obrigar a criar uma regra nova só para publicar, o operador ajusta ali.
//
// O cálculo vem do mesmo motor e do mesmo contexto econômico da varredura —
// muda só o objetivo. Assim o preço ajustado continua incluindo comissão,
// frete, imposto e embalagem, e não vira um número digitado no escuro.
//
// FASE 1: aceita também `preco`, e aí responde a pergunta inversa — "se eu
// vender por este valor, quanto sobra?". É a mesma porta que campanhas e
// preço por quantidade vão usar na Fase 2, e por isso ela existe agora, com
// uma tela só usando.

export async function POST(req: Request) {
  const { anuncioId, margem, preco } = await req.json() as {
    anuncioId: string; margem?: number; preco?: number
  }
  const querMargem = Number(margem) > 0
  const querPreco = Number(preco) > 0
  if (!anuncioId || (!querMargem && !querPreco)) {
    return NextResponse.json({ ok: false, erro: 'Informe o anúncio e uma margem ou um preço' }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: anuncio } = await sb.from('marketplace_anuncios')
    .select(`${COLUNAS_ANUNCIO}, produtos(${COLUNAS_PRODUTO})`)
    .eq('id', anuncioId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!anuncio) return NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 })

  const p: any = (anuncio as any).produtos
  if (!p) return NextResponse.json({ ok: false, erro: 'Anúncio sem produto vinculado' }, { status: 400 })

  // O canal é buscado pela empresa da sessão, não só pelo id que veio do
  // anúncio: uma linha a menos por onde uma empresa poderia ler a
  // configuração de outra.
  const { data: canal } = await sb.from('marketplace_canais').select(COLUNAS_CANAL)
    .eq('id', (anuncio as any).canal_id).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!canal) return NextResponse.json({ ok: false, erro: 'Canal não encontrado' }, { status: 404 })

  const resolvedor = criarResolvedor(sb, guarda.empresaId)
  const ctx = await resolvedor.contexto({ canal, produto: p, anuncio })
  if (!(ctx.economia.custo > 0)) {
    return NextResponse.json({ ok: false, erro: 'Produto sem custo cadastrado' }, { status: 400 })
  }

  const cenario = querPreco
    ? avaliarPreco(ctx.economia, Number(preco), 'preço informado')
    : precificarPorObjetivo(ctx.economia, { tipo: 'margem_liquida', valor: Number(margem) })

  const r = cenario.resultado
  return NextResponse.json({
    ok: true,
    preco: r.preco,
    margem: Number(r.margemLiquida.toFixed(2)),
    lucro: r.lucro,
    lucroSobreCusto: cenario.lucroSobreCusto,
    comissao: r.comissao,
    frete: r.frete,
    imposto: r.imposto,
    custo: ctx.economia.custo,
    saude: cenario.saude,
    regime: r.regime,
    origem: descreverOrigem(ctx),
    origemComissao: ctx.origemComissao,
    origemFrete: ctx.origemFrete,
    linhas: r.linhas,
    avisos: [...r.avisos, ...ctx.avisos],
    produtoId: p.id,
  })
}
