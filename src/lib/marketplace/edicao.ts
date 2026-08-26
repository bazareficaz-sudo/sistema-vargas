import { atualizarAnuncio as atualizarShopee, type AtributoInput } from '@/lib/shopee/listing'
import { pushPrecoEstoque } from '@/lib/shopee/write'
import { refreshAccessTokenIfNeeded as refrescarShopee } from '@/lib/shopee/client'
import { syncSingleItem as syncItemShopee } from '@/lib/shopee/sync'
import type { ShopeeChannel } from '@/lib/shopee/types'
import { atualizarAnuncio as atualizarML, type AtributoInputML } from '@/lib/mercadolivre/listing'
import { atualizarPrecoEstoque as precoEstoqueML } from '@/lib/mercadolivre/write'
import { mlPut, refreshAccessTokenIfNeeded as refrescarML } from '@/lib/mercadolivre/client'
import { syncSingleItem as syncItemML } from '@/lib/mercadolivre/sync'
import type { MLChannel } from '@/lib/mercadolivre/types'
import { plataformaAceitaEdicao } from './conteudoAnuncio'

// Envio de uma EDIÇÃO de anúncio para o canal.
//
// Mesma divisão que `envio.ts` já usa para preço e estoque: quem chama decide
// O QUE mudou, este arquivo sabe COMO cada plataforma recebe a mudança. A
// diferença é o escopo — `envio.ts` atende a fila automática, que só mexe em
// preço/estoque; aqui é o operador editando conteúdo, um anúncio por vez.
//
// Por que enviar em vez de só gravar aqui: `marketplace_anuncios` é um
// ESPELHO. A sincronização faz `upsert` por (canal_id, id_externo) e
// sobrescreve título, descrição, imagens e preço com o que a plataforma diz.
// Uma edição que ficasse só no banco duraria até a próxima rodada do cron —
// e a tela teria mentido para quem editou.

export type CanalEdicao = {
  id: string
  empresa_id: string
  plataforma: string
  seller_id: string
  access_token: string
  refresh_token: string | null
  token_expira_em: string | null
}

export type ImagemEdicao = { url: string; idExterno: string | null }

export type CamposEdicao = {
  titulo?: string
  descricao?: string
  imagens?: ImagemEdicao[]
  /** Atributos no formato da própria plataforma — não existe formato comum:
   *  a Shopee trabalha com ids numéricos de valor, o ML com o nome do valor. */
  atributosShopee?: AtributoInput[]
  atributosML?: AtributoInputML[]
  marcaId?: number
  marcaNome?: string
  pesoKg?: number
  comprimentoCm?: number
  larguraCm?: number
  alturaCm?: number
  skuCanal?: string
  preco?: number | null
  estoque?: number | null
  variacoes?: { modelId: string; preco?: number | null; estoque?: number | null }[]
  /** `description_type` do anúncio na Shopee (ver `atualizarAnuncio` lá). */
  tipoDescricao?: string | null
}

export type ResultadoEdicao = {
  ok: boolean
  erro?: string
  avisos: string[]
  /** Id local do anúncio depois de re-sincronizado, quando deu para trazer
   *  o item de volta da plataforma. */
  ressincronizado: boolean
}

export async function enviarEdicao(
  sb: any, canal: CanalEdicao, idExterno: string, campos: CamposEdicao,
): Promise<ResultadoEdicao> {
  if (!plataformaAceitaEdicao(canal.plataforma)) {
    return {
      ok: false, ressincronizado: false, avisos: [],
      erro: `Editar conteúdo em "${canal.plataforma}" ainda não está implementado — a alteração foi guardada só aqui.`,
    }
  }
  if (!canal.access_token) {
    return {
      ok: false, ressincronizado: false, avisos: [],
      erro: 'Canal não conectado — refaça a autenticação em Configurar.',
    }
  }

  try {
    if (canal.plataforma === 'shopee') return await enviarShopee(sb, canal, idExterno, campos)
    return await enviarMercadoLivre(sb, canal, idExterno, campos)
  } catch (e: unknown) {
    return {
      ok: false, ressincronizado: false, avisos: [],
      erro: e instanceof Error ? e.message : 'Erro ao enviar a edição para o canal',
    }
  }
}

// ── Shopee ──────────────────────────────────────────────────────────────────

async function enviarShopee(
  sb: any, canalRow: CanalEdicao, idExterno: string, campos: CamposEdicao,
): Promise<ResultadoEdicao> {
  const avisos: string[] = []
  const itemId = Number(idExterno)
  if (!Number.isFinite(itemId)) {
    return { ok: false, erro: `ID externo inválido para a Shopee: "${idExterno}"`, avisos, ressincronizado: false }
  }

  let canal: ShopeeChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token,
    tokenExpiraEm: canalRow.token_expira_em,
  } as ShopeeChannel
  canal = await refrescarShopee(sb, canal)

  const conteudo = await atualizarShopee(sb, canal, {
    itemId,
    titulo: campos.titulo,
    descricao: campos.descricao,
    imagens: campos.imagens,
    atributos: campos.atributosShopee,
    brandId: campos.marcaId,
    brandNome: campos.marcaNome,
    pesoKg: campos.pesoKg,
    comprimentoCm: campos.comprimentoCm,
    larguraCm: campos.larguraCm,
    alturaCm: campos.alturaCm,
    skuCanal: campos.skuCanal,
    tipoDescricao: campos.tipoDescricao,
  })
  if (!conteudo.ok) return { ok: false, erro: conteudo.erro, avisos, ressincronizado: false }
  avisos.push(...conteudo.avisos)

  // Preço e estoque numa chamada só: `pushPrecoEstoque` já aceita a lista de
  // alvos, com ou sem variação. Anúncio com variação NÃO recebe preço no
  // nível do item — lá o preço mora em cada modelo.
  const alvos = (campos.variacoes?.length ?? 0) > 0
    ? campos.variacoes!.map(v => ({ modelId: v.modelId, preco: v.preco ?? undefined, estoque: v.estoque ?? undefined }))
    : [{ preco: campos.preco ?? undefined, estoque: campos.estoque ?? undefined }]

  const temPrecoOuEstoque = alvos.some(a => a.preco != null || a.estoque != null)
  if (temPrecoOuEstoque) {
    const r = await pushPrecoEstoque({ sb, canal }, itemId, alvos)
    if (!r.precoOk) avisos.push(`Preço não enviado: ${r.erroPreco ?? 'a Shopee recusou'}`)
    if (!r.estoqueOk) avisos.push(`Estoque não enviado: ${r.erroEstoque ?? 'a Shopee recusou'}`)
  }

  const ressincronizado = await ressincronizar(() => syncItemShopee(sb, canal, idExterno), avisos)
  return { ok: true, avisos, ressincronizado }
}

// ── Mercado Livre ───────────────────────────────────────────────────────────

async function enviarMercadoLivre(
  sb: any, canalRow: CanalEdicao, idExterno: string, campos: CamposEdicao,
): Promise<ResultadoEdicao> {
  const avisos: string[] = []
  let canal: MLChannel = {
    id: canalRow.id, empresaId: canalRow.empresa_id, sellerId: canalRow.seller_id,
    accessToken: canalRow.access_token, refreshToken: canalRow.refresh_token,
    tokenExpiraEm: canalRow.token_expira_em,
  } as MLChannel
  canal = await refrescarML(sb, canal)

  const conteudo = await atualizarML(sb, canal, {
    itemId: idExterno,
    titulo: campos.titulo,
    descricao: campos.descricao,
    imagens: campos.imagens,
    atributos: campos.atributosML,
    skuCanal: campos.skuCanal,
  })
  if (!conteudo.ok) return { ok: false, erro: conteudo.erro, avisos, ressincronizado: false }
  avisos.push(...conteudo.avisos)

  if ((campos.variacoes?.length ?? 0) > 0) {
    // No ML a variação é um objeto dentro do item, e o PUT exige a lista
    // inteira do que se quer mudar — uma chamada, não uma por variação.
    const variations = campos.variacoes!
      .filter(v => v.preco != null || v.estoque != null)
      .map(v => ({
        id: Number(v.modelId),
        ...(v.preco != null ? { price: v.preco } : {}),
        ...(v.estoque != null ? { available_quantity: v.estoque } : {}),
      }))
    if (variations.length > 0) {
      try {
        await mlPut(`/items/${idExterno}`, { variations }, canal.accessToken)
      } catch (e: any) {
        avisos.push(`Preço/estoque das variações não enviados: ${e?.message ?? 'o Mercado Livre recusou'}`)
      }
    }
  } else if (campos.preco != null || campos.estoque != null) {
    const r = await precoEstoqueML(sb, canal, idExterno, {
      preco: campos.preco ?? undefined, estoque: campos.estoque ?? undefined,
    })
    if (!r.ok) avisos.push(`Preço/estoque não enviados: ${r.erro ?? 'o Mercado Livre recusou'}`)
  }

  const ressincronizado = await ressincronizar(() => syncItemML(sb, canal, idExterno), avisos)
  return { ok: true, avisos, ressincronizado }
}

// ── Volta ───────────────────────────────────────────────────────────────────

/**
 * Puxa o item de volta depois de editar.
 *
 * Não é enfeite: o que a plataforma aceitou pode não ser exatamente o que foi
 * mandado — ela corta título, recusa um atributo, reprocessa a foto e troca a
 * URL. Reler é o que mantém a tela mostrando o anúncio de verdade em vez do
 * que se pediu que ele fosse. Falhar aqui não invalida a edição: ela já
 * aconteceu lá.
 */
async function ressincronizar(
  executar: () => Promise<{ ok: true; anuncioId: string } | { ok: false; error: string }>,
  avisos: string[],
): Promise<boolean> {
  try {
    const r = await executar()
    if (r.ok) return true
    avisos.push(`A edição foi enviada, mas não deu para reler o anúncio agora: ${r.error}`)
    return false
  } catch (e: any) {
    avisos.push(`A edição foi enviada, mas não deu para reler o anúncio agora: ${e?.message ?? 'erro na leitura'}`)
    return false
  }
}
