// Revisão de preço dos KITS que têm algum componente numa entrada de
// mercadoria (manual ou XML).
//
// A nota mexe no custo — e às vezes no preço — das peças; o kit que usa
// essas peças fica com um preço decidido sobre números que já não valem.
// Esta revisão lista esses kits com o que mudou (custo das peças, soma das
// peças avulsas, margem) e deixa o operador decidir o preço novo. Nada muda
// sozinho: o preço sugerido é só ponto de partida.
//
// A sugestão segue a mesma regra de `reprecificarKitsQueUsam` (kit.ts):
// kit quase sempre é vendido com desconto sobre a soma das peças, e o que se
// preserva é essa RELAÇÃO. Um kit que valia 10% menos que as peças continua
// valendo 10% menos depois do reajuste. Para isso é preciso saber o preço das
// peças ANTES da nota — o XML grava em `nfe_itens.preco_atual` (desde esta
// revisão) e a entrada manual em `historico_precos`. Sem esse dado não há
// sugestão, e o kit fica com o preço de hoje até o operador mexer.

import { sincronizarProdutoVinculado } from './vinculo'

export type OrigemEntrada = 'manual' | 'xml'

export type ComponenteDoKit = {
  produtoId: string
  nome: string
  sku: string | null
  quantidade: number
  precoVenda: number
  /** Preço de venda da peça antes da nota; null quando não se sabe ou é peça de fora da nota. */
  precoAntes: number | null
  custo: number
  daEntrada: boolean
}

export type KitDaEntrada = {
  kitId: string
  nome: string
  sku: string | null
  precoAtual: number
  /** Custo somado das peças, com o custo que a nota deixou gravado. */
  custo: number
  /** false quando alguma peça está sem custo: a soma não é o custo do kit. */
  custoConfiavel: boolean
  /** Quanto as peças custam avulsas, hoje. */
  somaPecas: number
  /** Quanto as peças custavam avulsas antes da nota; null quando não se sabe. */
  somaPecasAntes: number | null
  /** O kit teve o preço mudado depois da nota — sugerir de novo dobraria o reajuste. */
  revisadoDepois: boolean
  promocao: number | null
  componentes: ComponenteDoKit[]
  sugestao: number | null
}

export const arred2 = (v: number) => Math.round(v * 100) / 100

/** Markup sobre o custo, em %. null sem custo. */
export function markupDe(preco: number, custo: number): number | null {
  return custo > 0 ? ((preco / custo) - 1) * 100 : null
}

/** Desconto do kit sobre as peças avulsas, em %. Negativo = kit mais caro que as peças. */
export function descontoSobrePecas(preco: number, somaPecas: number): number | null {
  return somaPecas > 0 ? (1 - preco / somaPecas) * 100 : null
}

export function precoComDesconto(somaPecas: number, descontoPct: number): number {
  return Math.max(0, arred2(somaPecas * (1 - descontoPct / 100)))
}

export function precoComMarkup(custo: number, markupPct: number): number {
  return Math.max(0, arred2(custo * (1 + markupPct / 100)))
}

/** Troca os centavos por ,90 ou ,99 — sem passar do preço inteiro seguinte. */
export function arredondarFinal(preco: number, final: '.90' | '.99'): number {
  if (!(preco > 0)) return preco
  return Math.floor(preco) + (final === '.90' ? 0.9 : 0.99)
}

/**
 * Preço que mantém o desconto (ou acréscimo) que o kit tinha sobre a soma
 * das peças. null quando não há o que sugerir: peças sem preço anterior
 * conhecido, soma que não mudou, ou kit já revisto depois da nota.
 */
export function sugerirPrecoKit(k: {
  precoAtual: number; somaPecas: number; somaPecasAntes: number | null; revisadoDepois: boolean
}): number | null {
  if (k.revisadoDepois || k.somaPecasAntes == null) return null
  if (!(k.somaPecasAntes > 0) || !(k.somaPecas > 0) || !(k.precoAtual > 0)) return null
  if (Math.abs(k.somaPecas - k.somaPecasAntes) < 0.005) return null
  const sugestao = arred2(k.somaPecas * (k.precoAtual / k.somaPecasAntes))
  return sugestao === k.precoAtual ? null : sugestao
}

/** Monta o kit a partir das peças — separado da consulta para poder testar. */
export function montarKit(base: {
  kitId: string; nome: string; sku: string | null; precoAtual: number
  revisadoDepois: boolean; promocao: number | null
}, componentes: ComponenteDoKit[]): KitDaEntrada {
  const custo = arred2(componentes.reduce((s, c) => s + c.custo * c.quantidade, 0))
  const custoConfiavel = componentes.length > 0 && componentes.every(c => c.custo > 0)
  const somaPecas = arred2(componentes.reduce((s, c) => s + c.precoVenda * c.quantidade, 0))
  const algumaAntes = componentes.some(c => c.precoAntes != null)
  const somaPecasAntes = algumaAntes
    ? arred2(componentes.reduce((s, c) => s + (c.precoAntes ?? c.precoVenda) * c.quantidade, 0))
    : null
  const kit = { ...base, custo, custoConfiavel, somaPecas, somaPecasAntes, componentes, sugestao: null as number | null }
  kit.sugestao = sugerirPrecoKit(kit)
  return kit
}

/* eslint-disable @typescript-eslint/no-explicit-any -- cliente Supabase sem tipos gerados, como no resto de lib/produtos */

async function emLotes<T>(ids: string[], consulta: (lote: string[]) => Promise<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await consulta(ids.slice(i, i + 150))
    out.push(...(data ?? []))
  }
  return out
}

export type ResultadoKitsDaEntrada = { kits: KitDaEntrada[]; rotulo: string; dataEntrada: string | null }

export async function carregarKitsDaEntrada(
  sb: any, empresaId: string, origem: OrigemEntrada, entradaId: string,
): Promise<ResultadoKitsDaEntrada> {
  // 1. Peças da nota e, quando houver, o preço delas antes da nota.
  const precoAntes = new Map<string, number>()
  let produtoIds: string[] = []
  let rotulo = ''
  let dataEntrada: string | null = null

  if (origem === 'xml') {
    const [{ data: ent }, { data: itens }] = await Promise.all([
      sb.from('nfe_entradas').select('numero, serie, created_at').eq('id', entradaId).maybeSingle(),
      sb.from('nfe_itens').select('produto_id, preco_atual').eq('entrada_id', entradaId),
    ])
    rotulo = ent ? `NF-e ${ent.numero ?? '—'}${ent.serie ? '/' + ent.serie : ''}` : 'NF-e'
    dataEntrada = ent?.created_at ?? null
    for (const i of (itens ?? []) as any[]) {
      if (!i.produto_id) continue
      produtoIds.push(i.produto_id)
      if (Number(i.preco_atual) > 0) precoAntes.set(i.produto_id, Number(i.preco_atual))
    }
  } else {
    const [{ data: ent }, { data: itens }, { data: hist }] = await Promise.all([
      sb.from('entradas').select('numero_entrada, numero_nf, created_at').eq('id', entradaId).maybeSingle(),
      sb.from('entrada_itens').select('produto_id').eq('entrada_id', entradaId),
      sb.from('historico_precos').select('produto_id, preco_venda_anterior, created_at')
        .eq('entrada_id', entradaId).order('created_at', { ascending: true }),
    ])
    rotulo = ent?.numero_entrada ?? (ent?.numero_nf ? `NF ${ent.numero_nf}` : 'Entrada')
    dataEntrada = ent?.created_at ?? null
    produtoIds = ((itens ?? []) as any[]).map(i => i.produto_id).filter(Boolean)
    // O primeiro registro do produto nesta entrada é o preço de antes dela.
    for (const h of (hist ?? []) as any[]) {
      if (h.produto_id && !precoAntes.has(h.produto_id) && Number(h.preco_venda_anterior) > 0) {
        precoAntes.set(h.produto_id, Number(h.preco_venda_anterior))
      }
    }
  }
  produtoIds = Array.from(new Set(produtoIds))
  if (produtoIds.length === 0) return { kits: [], rotulo, dataEntrada }
  const daEntrada = new Set(produtoIds)

  // 2. Kits que usam alguma dessas peças.
  const usos = await emLotes<any>(produtoIds, lote => sb.from('kit_itens').select('kit_id').in('produto_id', lote))
  const kitIds = Array.from(new Set(usos.map(u => u.kit_id).filter(Boolean))) as string[]
  if (kitIds.length === 0) return { kits: [], rotulo, dataEntrada }

  const kitsRows = (await emLotes<any>(kitIds, lote => sb.from('produtos')
    .select('id, nome, sku, preco_venda, ativo, preco_atualizado_em, preco_promocional, promocao_ativa, empresa_id')
    .in('id', lote)))
    .filter(k => k.empresa_id === empresaId && k.ativo !== false)
  if (kitsRows.length === 0) return { kits: [], rotulo, dataEntrada }

  // 3. A composição inteira de cada kit — a soma das peças inclui as que
  //    não vieram na nota.
  const composicao = await emLotes<any>(kitsRows.map(k => k.id), lote => sb.from('kit_itens')
    .select('kit_id, produto_id, quantidade').in('kit_id', lote))
  const pecaIds = Array.from(new Set(composicao.map(c => c.produto_id).filter(Boolean))) as string[]
  const pecas = new Map<string, any>((await emLotes<any>(pecaIds, lote => sb.from('produtos')
    .select('id, nome, sku, preco_venda, preco_custo').in('id', lote))).map(p => [p.id, p]))

  const desde = dataEntrada ? new Date(dataEntrada).getTime() : null
  const kits = kitsRows.map(k => {
    const componentes: ComponenteDoKit[] = composicao.filter(c => c.kit_id === k.id).map(c => {
      const p = pecas.get(c.produto_id)
      return {
        produtoId: c.produto_id,
        nome: p?.nome ?? 'Produto removido',
        sku: p?.sku ?? null,
        quantidade: Number(c.quantidade) || 0,
        precoVenda: Number(p?.preco_venda ?? 0),
        precoAntes: precoAntes.get(c.produto_id) ?? null,
        custo: Number(p?.preco_custo ?? 0),
        daEntrada: daEntrada.has(c.produto_id),
      }
    })
    const revisadoEm = k.preco_atualizado_em ? new Date(k.preco_atualizado_em).getTime() : null
    return montarKit({
      kitId: k.id, nome: k.nome ?? 'Kit', sku: k.sku ?? null, precoAtual: Number(k.preco_venda ?? 0),
      revisadoDepois: desde != null && revisadoEm != null && revisadoEm >= desde,
      promocao: k.promocao_ativa && Number(k.preco_promocional) > 0 ? Number(k.preco_promocional) : null,
    }, componentes)
  })
  kits.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  return { kits, rotulo, dataEntrada }
}

export type MudancaPrecoKit = { kit: KitDaEntrada; precoNovo: number }

/**
 * Grava os preços novos. Devolve quantos foram gravados e os erros por kit —
 * um kit que falha não impede os outros.
 */
export async function aplicarPrecosKits(sb: any, empresaId: string, mudancas: MudancaPrecoKit[], ctx: {
  origem: OrigemEntrada; entradaId: string; rotulo: string
}): Promise<{ gravados: string[]; erros: string[] }> {
  const { data: auth } = await sb.auth.getUser()
  const usuario = auth?.user?.email ?? null
  const gravados: string[] = []
  const erros: string[] = []

  for (const { kit, precoNovo } of mudancas) {
    const agora = new Date().toISOString()
    const markupNovo = markupDe(precoNovo, kit.custo)
    const { error } = await sb.from('produtos').update({
      preco_venda: precoNovo,
      markup: markupNovo != null ? arred2(markupNovo) : null,
      updated_at: agora,
      preco_atualizado_em: agora,
    }).eq('id', kit.kitId).eq('empresa_id', empresaId)
    if (error) { erros.push(`${kit.nome}: ${error.message}`); continue }
    gravados.push(kit.kitId)

    await sincronizarProdutoVinculado(sb, kit.kitId, {}, { preco_venda: precoNovo })

    const margemAntes = markupDe(kit.precoAtual, kit.custo)
    // historico_precos.entrada_id aponta para `entradas` (manual); a nota
    // por XML fica identificada pelo número.
    await sb.from('historico_precos').insert({
      empresa_id: empresaId,
      produto_id: kit.kitId,
      produto_nome: kit.nome,
      produto_sku: kit.sku,
      entrada_id: ctx.origem === 'manual' ? ctx.entradaId : null,
      numero_entrada: ctx.origem === 'manual' ? ctx.rotulo : null,
      numero_nf: ctx.origem === 'xml' ? ctx.rotulo.replace(/^NF-e\s*/, '') : null,
      preco_venda_anterior: kit.precoAtual,
      preco_venda_novo: precoNovo,
      custo_anterior: kit.custo,
      custo_novo: kit.custo,
      margem_anterior: margemAntes != null ? arred2(margemAntes) : null,
      margem_nova: markupNovo != null ? arred2(markupNovo) : null,
      variacao_custo_pct: 0,
      usuario_nome: usuario,
      motivo: `Revisão de kit pela entrada ${ctx.rotulo}`,
    })
  }
  return { gravados, erros }
}
