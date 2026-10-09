// PUBLICAÇÃO EM LOTE NA SHOPEE — preparar o rascunho de cada anúncio.
//
// O mesmo papel de loteTiktok.ts, com o que é próprio da Shopee:
//   • categoria: 1º a que a loja JÁ ESCOLHEU para a mesma categoria interna
//     (marketplace_categoria_sugestao — a criação de anúncio grava isso);
//     2º a sugestão oficial da Shopee pelo título; 3º a dedução por palavras
//     (marcada como aproximada);
//   • atributos obrigatórios: lista → preenchido quando o nome traz o valor;
//     texto livre → pendência para a pessoa digitar;
//   • marca: a da Shopee com o mesmo nome; senão "Sem marca" (NoBrand), que
//     a Shopee aceita;
//   • canais de envio: os habilitados na loja;
//   • título até 120 caracteres e descrição de pelo menos 60.
// A publicação usa a rota do modal (/api/marketplace/shopee/criar-anuncio).

import {
  deduzirCategoriaPorPalavras, getAttributeTree, getBrandList, getLogisticsChannels, recomendarCategoria, resolverCaminhoPorCategoria,
  type AtributoShopee, type CaminhoCategoriaResolvido, type MarcaShopee,
} from '@/lib/shopee/listing'
import { refreshAccessTokenIfNeeded } from '@/lib/shopee/client'
import type { ShopeeChannel } from '@/lib/shopee/types'
import { COLUNAS_PRODUTO } from '@/lib/precificacao/contexto'
import { criarPrecificadorCanal, type PrecificadorCanal } from './precoCanal'
import { norm, pendenciasDoRascunho, respostaCaboEletrico, tituloLimpo, valorPeloNome, type AtributoRascunho, type RascunhoAnuncio } from './loteTiktokRegras'

export const TITULO_MAX_SHOPEE = 120
export const DESCRICAO_MIN_SHOPEE = 60
const ENTRADA_TEXTO = 3

export type ContextoLoteShopee = {
  sb: any
  empresaId: string
  canal: ShopeeChannel
  precoDoCanal: PrecificadorCanal
  logistica: number[] | null
  atributosPorCategoria: Map<number, AtributoShopee[]>
  marcasPorCategoria: Map<number, MarcaShopee[]>
}

export async function criarContextoLoteShopee(sb: any, empresaId: string, canalRow: any): Promise<ContextoLoteShopee> {
  const canal = await refreshAccessTokenIfNeeded(sb, {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token, tokenExpiraEm: canalRow.token_expira_em,
  } as ShopeeChannel)
  return {
    sb, empresaId, canal, precoDoCanal: await criarPrecificadorCanal(sb, empresaId, canalRow.id),
    logistica: null, atributosPorCategoria: new Map(), marcasPorCategoria: new Map(),
  }
}

const caminhoTexto = (r: CaminhoCategoriaResolvido) => r.caminho.map(c => c.original_category_name).join(' > ')

async function categoriaDoProduto(ctx: ContextoLoteShopee, produto: any, titulo: string): Promise<RascunhoAnuncio['categoria'] & { ids: string[] } | null> {
  const api = { sb: ctx.sb, canal: ctx.canal }
  // 1. A que a loja já escolheu para a mesma categoria interna.
  if (produto.categoria) {
    const { data: lembrada } = await ctx.sb.from('marketplace_categoria_sugestao')
      .select('categoria_ids').eq('empresa_id', ctx.empresaId).eq('canal_id', ctx.canal.id)
      .eq('produto_categoria', produto.categoria).maybeSingle()
    const ultimo = Array.isArray(lembrada?.categoria_ids) ? lembrada.categoria_ids[lembrada.categoria_ids.length - 1] : null
    if (ultimo) {
      try {
        const r = await resolverCaminhoPorCategoria(api, Number(ultimo))
        if (r) return { id: String(ultimo), caminho: caminhoTexto(r), ids: r.caminho.map(c => String(c.category_id)), origem: `já usada antes em produtos de "${produto.categoria}"` }
      } catch { /* segue para a sugestão */ }
    }
  }
  // 2. A sugestão oficial da Shopee.
  try {
    const r = await recomendarCategoria(api, titulo)
    const folha = r?.caminho[r.caminho.length - 1]
    if (r && folha && !folha.has_children) return { id: String(folha.category_id), caminho: caminhoTexto(r), ids: r.caminho.map(c => String(c.category_id)), origem: 'sugerida pela Shopee' }
  } catch { /* segue para a dedução */ }
  // 3. Dedução por palavras — aproximada.
  try {
    const r = await deduzirCategoriaPorPalavras(api, titulo, produto.categoria)
    const folha = r?.caminho[r.caminho.length - 1]
    if (r && folha) return { id: String(folha.category_id), caminho: caminhoTexto(r), aproximada: true, ids: r.caminho.map(c => String(c.category_id)), origem: 'achada pelas palavras do nome' }
  } catch { /* sem categoria: vira pendência */ }
  return null
}

export async function prepararRascunhoShopee(
  ctx: ContextoLoteShopee, produtoId: string, categoriaForcada?: { id: string; caminho: string; ids?: string[] } | null,
): Promise<RascunhoAnuncio> {
  const api = { sb: ctx.sb, canal: ctx.canal }
  const { data: produto } = await ctx.sb.from('produtos')
    .select(`${COLUNAS_PRODUTO}, ean, descricao_marketplace`)
    .eq('id', produtoId).eq('empresa_id', ctx.empresaId).maybeSingle()
  if (!produto) throw new Error('Produto não encontrado')
  const { data: imagens } = await ctx.sb.from('produto_imagens')
    .select('url, principal').eq('produto_id', produtoId).order('principal', { ascending: false }).order('ordem', { ascending: true })
  const fotos = (imagens ?? []).map((i: any) => i.url).slice(0, 9)
  const titulo = tituloLimpo(produto.nome).slice(0, TITULO_MAX_SHOPEE)
  const descricao = String(produto.descricao_marketplace ?? '').trim()

  const cat = categoriaForcada
    ? { id: categoriaForcada.id, caminho: categoriaForcada.caminho, ids: categoriaForcada.ids ?? [categoriaForcada.id] }
    : await categoriaDoProduto(ctx, produto, titulo)

  let atributos: AtributoRascunho[] = []
  let marca: RascunhoAnuncio['marca'] = { id: '0', nome: 'Sem marca' }
  if (cat) {
    const idNum = Number(cat.id)
    try {
      let lista = ctx.atributosPorCategoria.get(idNum)
      if (!lista) { lista = await getAttributeTree(api, idNum); ctx.atributosPorCategoria.set(idNum, lista) }
      atributos = lista.filter(a => a.is_mandatory).map(a => {
        const valores = a.attribute_value_list.map(v => ({ id: String(v.value_id), nome: v.original_value_name }))
        const v = valores.length
          ? (respostaCaboEletrico(a.attribute_name, produto.nome, valores) ?? valorPeloNome(`${produto.nome} ${produto.marca ?? ''}`, valores))
          : null
        return {
          id: String(a.attribute_id), nome: a.attribute_name, obrigatorio: true,
          multiplo: a.input_type === 4 || a.input_type === 5, personalizavel: a.input_type !== 1 && a.input_type !== 4,
          valores: a.input_type === ENTRADA_TEXTO ? [] : valores,
          valorId: v?.id ?? null, valorTexto: null, inputType: a.input_type,
        }
      })
    } catch { /* atributos indisponíveis: a publicação diz o que falta */ }
    if (produto.marca) {
      try {
        let marcas = ctx.marcasPorCategoria.get(idNum)
        if (!marcas) { marcas = await getBrandList(api, idNum); ctx.marcasPorCategoria.set(idNum, marcas) }
        const m = marcas.find(x => norm(x.original_brand_name).trim() === norm(produto.marca).trim())
        if (m) marca = { id: String(m.brand_id), nome: m.original_brand_name }
      } catch { /* fica "Sem marca" */ }
    }
  }

  if (!ctx.logistica) {
    try { ctx.logistica = (await getLogisticsChannels(api)).filter(c => c.enabled).map(c => c.logistic_id) }
    catch { ctx.logistica = [] }
  }

  const { preco, origem } = await ctx.precoDoCanal(produto)
  const rascunho: RascunhoAnuncio = {
    produtoId, nome: produto.nome, sku: produto.sku ?? null, ean: produto.ean ?? null,
    foto: fotos[0] ?? null, fotos, titulo, descricao, preco, origemPreco: origem,
    estoque: Math.max(0, Math.floor(Number(produto.estoque ?? 0))),
    peso: produto.peso_kg != null ? Number(produto.peso_kg) : null,
    comprimento: produto.comprimento_cm != null ? Number(produto.comprimento_cm) : null,
    largura: produto.largura_cm != null ? Number(produto.largura_cm) : null,
    altura: produto.altura_cm != null ? Number(produto.altura_cm) : null,
    categoria: cat ? {
      id: cat.id, caminho: cat.caminho,
      ...(('aproximada' in cat && cat.aproximada) ? { aproximada: true } : {}),
      origem: ('origem' in cat && cat.origem) ? cat.origem : 'escolhida por você',
    } : null,
    categoriaIds: cat?.ids ?? [],
    marca, atributos, medidasObrigatorias: true,
    plataforma: 'shopee', tituloMax: TITULO_MAX_SHOPEE, descricaoMinima: DESCRICAO_MIN_SHOPEE,
    logistica: ctx.logistica ?? [], pendencias: [],
  }
  rascunho.pendencias = pendenciasDoRascunho(rascunho)
  return rascunho
}
