// GTIN DOS ANÚNCIOS DA SHOPEE — varrer e corrigir. Regras em gtinRegras.ts.
//
// Lê o estado DIRETO na Shopee (o `gtin_code` não é guardado no sistema):
// no anúncio simples, em `get_item_base_info`; no anúncio com variação, em
// cada modelo (`get_model_list`) — medido em 20/10/2026, 255 dos anúncios
// sem GTIN eram com variação. Cruza com o produto mapeado (do anúncio ou da
// variação) e propõe. Corrigir: `update_item` (simples) ou `update_model`
// (só as variações sem GTIN), e depois LÊ de volta — a Shopee já mostrou que
// "aceito" não quer dizer aplicado.

import { shopeeGet, shopeePost } from './client'
import type { CanalShopeeAtendimento } from './atendimento'
import { propostaDoProduto, propostaGtin, situacaoGtin, type AnuncioGtin, type ModeloGtin } from './gtinRegras'

const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))
type ProdutoRef = { id: string; nome: string; ean: string | null }

async function emParalelo<T, R>(itens: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; saida[k] = await f(itens[k]) }
  }))
  return saida
}

/** Variações de um anúncio: id, nome ("Branco / 110V") e GTIN de cada uma. */
async function modelosNaShopee(loja: CanalShopeeAtendimento, itemId: string): Promise<{ modelId: string; nome: string; gtin: unknown }[]> {
  const r = await shopeeGet('/api/v2/product/get_model_list', { item_id: itemId }, loja.opts)
  const tiers: any[] = r?.response?.tier_variation ?? []
  return (r?.response?.model ?? []).map((m: any) => ({
    modelId: String(m.model_id),
    nome: (m.tier_index ?? []).map((ix: number, t: number) => tiers[t]?.option_list?.[ix]?.option).filter(Boolean).join(' / ') || String(m.model_sku ?? m.model_id),
    gtin: m.gtin_code,
  }))
}

/**
 * Anúncios sem GTIN (ou com variação sem GTIN), com a proposta. Sem
 * `itemIds`, varre todos os ativos da loja.
 */
export async function prepararGtin(sb: any, loja: CanalShopeeAtendimento, itemIds?: string[]): Promise<AnuncioGtin[]> {
  let ids = itemIds
  if (!ids) {
    ids = []
    for (let off = 0; off < 10000; off += 100) {
      const r = await shopeeGet('/api/v2/product/get_item_list', { offset: off, page_size: 100, item_status: 'NORMAL' }, loja.opts)
      ids.push(...(r?.response?.item ?? []).map((x: any) => String(x.item_id)))
      if (!r?.response?.has_next_page) break
    }
  }

  type Base = { itemId: string; titulo: string; foto: string | null; gtin: unknown; temVariacao: boolean }
  const bases: Base[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const r = await shopeeGet('/api/v2/product/get_item_base_info', { item_id_list: ids.slice(i, i + 50).join(',') }, loja.opts)
    for (const it of r?.response?.item_list ?? []) bases.push({
      itemId: String(it.item_id), titulo: String(it.item_name ?? ''), foto: it.image?.image_url_list?.[0] ?? null,
      gtin: it.gtin_code, temVariacao: Boolean(it.has_model),
    })
  }

  // Simples: o GTIN do anúncio. Com variação: o de cada modelo.
  const simplesSem = bases.filter(b => !b.temVariacao && ['falta', 'invalido'].includes(situacaoGtin(b.gtin)))
  const comVariacao = bases.filter(b => b.temVariacao)
  const modelosSem = new Map<string, { modelId: string; nome: string; gtin: unknown }[]>()
  await emParalelo(comVariacao, 5, async b => {
    const ms = (await modelosNaShopee(loja, b.itemId).catch(() => [])).filter(m => ['falta', 'invalido'].includes(situacaoGtin(m.gtin)))
    if (ms.length) modelosSem.set(b.itemId, ms)
  })
  const alvo = [...simplesSem, ...comVariacao.filter(b => modelosSem.has(b.itemId))]

  // Produto mapeado: do anúncio (simples) e de cada variação.
  const prodAnuncio = new Map<string, ProdutoRef>()
  const prodModelo = new Map<string, ProdutoRef>()
  for (let i = 0; i < alvo.length; i += 200) {
    const { data } = await sb.from('marketplace_anuncios')
      .select('id_externo, produtos(id, nome, ean), marketplace_anuncio_variacoes(model_id, produtos(id, nome, ean))')
      .eq('canal_id', loja.id).in('id_externo', alvo.slice(i, i + 200).map(a => a.itemId))
    for (const a of data ?? []) {
      if (a.produtos) prodAnuncio.set(String(a.id_externo), a.produtos as ProdutoRef)
      for (const v of (a.marketplace_anuncio_variacoes ?? []) as { model_id: string; produtos: ProdutoRef | null }[]) {
        if (v.produtos) prodModelo.set(`${a.id_externo}:${v.model_id}`, v.produtos)
      }
    }
  }

  return alvo.map(b => {
    const produto = b.temVariacao ? null : prodAnuncio.get(b.itemId) ?? null
    const modelos: ModeloGtin[] = (modelosSem.get(b.itemId) ?? []).map(m => {
      const p = prodModelo.get(`${b.itemId}:${m.modelId}`) ?? null
      return { modelId: m.modelId, nome: m.nome, produto: p, proposta: propostaDoProduto(p) }
    })
    const situacao = b.temVariacao
      ? ((modelosSem.get(b.itemId) ?? []).some(m => situacaoGtin(m.gtin) === 'invalido') ? 'invalido' : 'falta')
      : situacaoGtin(b.gtin) as 'falta' | 'invalido'
    return {
      canalId: loja.id, canalNome: loja.nome, itemId: b.itemId, titulo: b.titulo, foto: b.foto,
      situacao, gtinAtual: !b.temVariacao && b.gtin ? String(b.gtin) : null,
      produto, temVariacao: b.temVariacao, modelos,
      ...propostaGtin({ produto, temVariacao: b.temVariacao, modelos }),
    }
  })
}

export type ResultadoGtin = { itemId: string; ok: boolean; erro?: string }

/** Manda o GTIN proposto (preparado AGORA, no servidor) e confere lendo de volta. */
export async function aplicarGtin(sb: any, loja: CanalShopeeAtendimento, itemIds: string[]): Promise<ResultadoGtin[]> {
  const preparados = await prepararGtin(sb, loja, itemIds)
  const porId = new Map(preparados.map(a => [a.itemId, a]))
  const resultados: ResultadoGtin[] = []
  for (const id of itemIds) {
    const a = porId.get(id)
    // Não está mais na lista: alguém já preencheu (ou o anúncio saiu do ar).
    if (!a) { resultados.push({ itemId: id, ok: true }); continue }
    if (!a.proposta) { resultados.push({ itemId: id, ok: false, erro: a.pendencia ?? 'sem proposta' }); continue }
    try {
      if (a.temVariacao) {
        // O campo é `model` (não `model_list`): com o outro nome a Shopee
        // recusou com "invalid UpdateModelRequest.Model: Model is required"
        // (medido em 22/10/2026, anúncios Evidence Fame de variação única).
        await shopeePost('/api/v2/product/update_model', {
          item_id: Number(id), model: a.modelos.map(m => ({ model_id: Number(m.modelId), gtin_code: m.proposta!.gtin })),
        }, loja.opts)
      } else {
        await shopeePost('/api/v2/product/update_item', { item_id: Number(id), gtin_code: a.proposta.gtin }, loja.opts)
      }
      resultados.push({ itemId: id, ok: true })
    } catch (e: unknown) {
      resultados.push({ itemId: id, ok: false, erro: e instanceof Error ? e.message : 'a Shopee recusou' })
    }
    await pausa(300)
  }
  // Confere: quem foi "aceito" e continua sem GTIN não foi aplicado.
  const aceitos = resultados.filter(r => r.ok && porId.has(r.itemId)).map(r => r.itemId)
  if (aceitos.length) {
    const aindaSem = new Set((await prepararGtin(sb, loja, aceitos).catch(() => [])).map(a => a.itemId))
    for (const r of resultados) if (r.ok && aindaSem.has(r.itemId)) { r.ok = false; r.erro = 'a Shopee aceitou mas o anúncio continua sem GTIN' }
  }
  return resultados
}
