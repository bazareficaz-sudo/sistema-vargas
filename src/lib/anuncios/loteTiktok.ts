// PUBLICAÇÃO EM LOTE NA TIKTOK — preparar o rascunho de cada anúncio.
//
// Para cada produto, monta o que a tela de criar anúncio montaria à mão:
//   • título: o nome do cadastro em caixa de anúncio;
//   • categoria: a que a TikTok sugere para o título;
//   • atributos obrigatórios da categoria: preenchidos quando o NOME do
//     produto traz o valor (ex.: "220V" na lista de voltagens) — sem chute;
//   • marca: a do cadastro, se a TikTok tiver uma com o mesmo nome e
//     autorizada para a loja;
//   • preço: o da regra de Precificação deste canal (a mesma conta do
//     recálculo); sem regra ou sem custo, o do cadastro, avisando;
//   • fotos, peso, medidas, estoque, SKU, EAN: do cadastro.
// O que não deu para resolver vira PENDÊNCIA na linha — a pessoa completa
// na grade antes de publicar. A publicação usa a mesma rota do modal de
// criar anúncio (/api/marketplace/tiktok/criar-anuncio).

import { buscarMarcas, listarCategoriasFolha, detalhesDaCategoria, recomendarCategoria, type CategoriaTiktok, type DetalhesCategoria } from '@/lib/tiktok/listing'
import {
  categoriaPorPalavras, norm, pendenciasDoRascunho, tituloLimpo, valorPeloNome, type AtributoRascunho, type RascunhoTiktok,
} from './loteTiktokRegras'

export type { AtributoRascunho, RascunhoTiktok } from './loteTiktokRegras'
export { categoriaPorPalavras, pendenciasDoRascunho, tituloLimpo, valorPeloNome } from './loteTiktokRegras'
import type { TiktokChannel } from '@/lib/tiktok/types'
import { COLUNAS_PRODUTO } from '@/lib/precificacao/contexto'
import { criarPrecificadorCanal, type PrecificadorCanal } from './precoCanal'

async function categoriaPelaPalavra(ctx: ContextoLote, titulo: string): Promise<CategoriaTiktok | null> {
  try {
    if (!ctx.folhas) ctx.folhas = await listarCategoriasFolha(ctx.sb, ctx.canal)
    return categoriaPorPalavras(ctx.folhas, titulo)
  } catch {
    return null
  }
}

export type ContextoLote = {
  sb: any
  empresaId: string
  canal: TiktokChannel
  precoDoCanal: PrecificadorCanal
  detalhesPorCategoria: Map<string, DetalhesCategoria>
  /** Árvore de categorias, lida uma vez por lote (plano B da categoria). */
  folhas?: CategoriaTiktok[]
}

export async function criarContextoLote(sb: any, empresaId: string, canal: TiktokChannel): Promise<ContextoLote> {
  return { sb, empresaId, canal, precoDoCanal: await criarPrecificadorCanal(sb, empresaId, canal.id), detalhesPorCategoria: new Map() }
}

async function detalhes(ctx: ContextoLote, categoryId: string): Promise<DetalhesCategoria> {
  const ja = ctx.detalhesPorCategoria.get(categoryId)
  if (ja) return ja
  const d = await detalhesDaCategoria(ctx.sb, ctx.canal, categoryId)
  ctx.detalhesPorCategoria.set(categoryId, d)
  return d
}

export async function prepararRascunho(ctx: ContextoLote, produtoId: string, categoriaForcada?: string | null): Promise<RascunhoTiktok> {
  const { data: produto } = await ctx.sb.from('produtos')
    .select(`${COLUNAS_PRODUTO}, ean, descricao_marketplace`)
    .eq('id', produtoId).eq('empresa_id', ctx.empresaId).maybeSingle()
  if (!produto) throw new Error('Produto não encontrado')
  const { data: imagens } = await ctx.sb.from('produto_imagens')
    .select('url, principal').eq('produto_id', produtoId).order('principal', { ascending: false }).order('ordem', { ascending: true })
  const fotos = (imagens ?? []).map((i: any) => i.url).slice(0, 9)
  const titulo = tituloLimpo(produto.nome)
  const descricao = String(produto.descricao_marketplace ?? '').trim()

  let categoria: RascunhoTiktok['categoria'] = null
  if (categoriaForcada) categoria = { id: categoriaForcada, caminho: '' }
  else {
    try {
      const c = await recomendarCategoria(ctx.sb, ctx.canal, titulo, descricao)
      if (c) categoria = { id: c.id, caminho: c.caminho, origem: 'sugerida pela TikTok' }
    } catch { /* a TikTok não achou pelo nome — tenta pela palavra principal */ }
    if (!categoria) {
      const c = await categoriaPelaPalavra(ctx, titulo)
      if (c) categoria = { id: c.id, caminho: c.caminho, aproximada: true, origem: 'achada pelas palavras do nome' }
    }
  }

  let atributos: AtributoRascunho[] = []
  let medidasObrigatorias = false
  let marca: RascunhoTiktok['marca'] = null
  if (categoria) {
    try {
      const d = await detalhes(ctx, categoria.id)
      medidasObrigatorias = d.medidasObrigatorias
      atributos = d.atributos.filter(a => a.obrigatorio).map(a => {
        const v = a.valores.length ? valorPeloNome(`${produto.nome} ${produto.marca ?? ''}`, a.valores) : null
        return { ...a, valorId: v?.id ?? null, valorTexto: null }
      })
      if (produto.marca) {
        const alvo = norm(produto.marca).trim()
        let m = d.marcas.find(x => norm(x.nome).trim() === alvo)
        if (!m) m = (await buscarMarcas(ctx.sb, ctx.canal, categoria.id, produto.marca)).find((x: any) => norm(x.nome).trim() === alvo)
        if (m?.autorizada) marca = { id: m.id, nome: m.nome }
      }
    } catch { /* atributos indisponíveis: a publicação diz o que falta */ }
  }

  const { preco, origem } = await ctx.precoDoCanal(produto)
  const rascunho: RascunhoTiktok = {
    produtoId, nome: produto.nome, sku: produto.sku ?? null, ean: produto.ean ?? null,
    foto: fotos[0] ?? null, fotos, titulo,
    descricao,
    preco, origemPreco: origem,
    estoque: Math.max(0, Math.floor(Number(produto.estoque ?? 0))),
    peso: produto.peso_kg != null ? Number(produto.peso_kg) : null,
    comprimento: produto.comprimento_cm != null ? Number(produto.comprimento_cm) : null,
    largura: produto.largura_cm != null ? Number(produto.largura_cm) : null,
    altura: produto.altura_cm != null ? Number(produto.altura_cm) : null,
    categoria, marca, atributos, medidasObrigatorias, pendencias: [],
  }
  rascunho.pendencias = pendenciasDoRascunho(rascunho)
  return rascunho
}
