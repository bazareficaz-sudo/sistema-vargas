import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { buscarConfigDoCanal } from '@/lib/precificacao/config'
import { calcular, saudeDaMargem } from '@/lib/precificacao/motor'
import { calcularKit } from '@/lib/produtos/kit'
import { resolverFreteML, embalagemDoAnuncio, logisticTypeDoAnuncio, listingTypeDoAnuncio } from '@/lib/precificacao/mlFrete'
import type { FaixaFrete } from '@/lib/precificacao/tipos'

// Recalcula UM anúncio da prévia com uma margem diferente da que a regra
// manda.
//
// Existe porque nem todo produto suporta a margem da regra: a regra da
// categoria pede 20%, mas naquele item o mercado só deixa 15%. Em vez de
// obrigar a criar uma regra nova só para publicar, o operador ajusta ali.
//
// O cálculo vem do mesmo motor e das mesmas taxas do canal — muda só o
// objetivo. Assim o preço ajustado continua incluindo comissão, frete,
// imposto e embalagem, e não vira um número digitado no escuro.

export async function POST(req: Request) {
  const { anuncioId, margem } = await req.json() as { anuncioId: string; margem: number }
  if (!anuncioId || !(Number(margem) > 0)) {
    return NextResponse.json({ ok: false, erro: 'Anúncio ou margem inválidos' }, { status: 400 })
  }

  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: anuncio } = await sb.from('marketplace_anuncios')
    .select('id, canal_id, dados_brutos, produtos(id, tipo, preco_custo, peso_kg, comprimento_cm, largura_cm, altura_cm)')
    .eq('id', anuncioId).eq('empresa_id', guarda.empresaId).maybeSingle()
  if (!anuncio) return NextResponse.json({ ok: false, erro: 'Anúncio não encontrado' }, { status: 404 })

  const p: any = anuncio.produtos
  if (!p) return NextResponse.json({ ok: false, erro: 'Anúncio sem produto vinculado' }, { status: 400 })

  const custo = p.tipo === 'kit'
    ? Number((await calcularKit(sb, p.id))?.custo ?? 0)
    : Number(p.preco_custo ?? 0)
  if (!(custo > 0)) return NextResponse.json({ ok: false, erro: 'Produto sem custo cadastrado' }, { status: 400 })

  const { data: canal } = await sb.from('marketplace_canais')
    .select('id, nome, plataforma, seller_id, access_token').eq('id', anuncio.canal_id).maybeSingle()
  if (!canal) return NextResponse.json({ ok: false, erro: 'Canal não encontrado' }, { status: 404 })

  const { cfg } = await buscarConfigDoCanal(sb, guarda.empresaId, canal)

  // O frete importado precisa valer aqui também. Sem isso, a linha ajustada
  // sairia com o custo médio antigo enquanto o resto da tela usa o valor real
  // do ML — e o operador veria dois preços que não se explicam.
  let freteFaixas: FaixaFrete[] | null = null
  const c: any = canal
  if (cfg.freteMlImportar && c.plataforma === 'mercadolivre' && c.access_token && c.seller_id) {
    const emb = embalagemDoAnuncio((anuncio as any).dados_brutos, p)
    if (emb) {
      try {
        const fr = await resolverFreteML(
          sb, { id: c.id, sellerId: String(c.seller_id), accessToken: c.access_token },
          emb, logisticTypeDoAnuncio((anuncio as any).dados_brutos), listingTypeDoAnuncio((anuncio as any).dados_brutos),
        )
        freteFaixas = fr.faixas
      } catch { /* cai no frete configurado, como na varredura */ }
    }
  }

  const r = calcular({
    cfg, custoProduto: custo, pesoKg: p.peso_kg != null ? Number(p.peso_kg) : null,
    freteFaixas,
    objetivo: { tipo: 'margem_liquida', valor: Number(margem) },
  })

  return NextResponse.json({
    ok: true,
    preco: r.preco,
    margem: Number(r.margemLiquida.toFixed(2)),
    lucro: r.lucro,
    saude: saudeDaMargem(r.margemLiquida, cfg.faixasSaude),
    avisos: r.avisos,
    produtoId: p.id,
  })
}
