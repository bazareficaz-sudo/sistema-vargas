import { shopeeGet, shopeePost, shopeeUploadImage, getIntegracaoCredentials } from './client'
import { syncSingleItem } from './sync'
import { ShopeeApiError, type ShopeeChannel } from './types'

// Criação de anúncio novo — diferente do resto da integração Shopee deste
// projeto (que só importa/atualiza anúncios já existentes). Confiança
// moderada-alta: endpoints e formato confirmados contra o SDK de terceiro
// congminh1254/shopee-sdk (mesma fonte já usada com sucesso pra logística/
// etiqueta nesta sessão), não contra a doc oficial (inacessível). Um ponto
// específico tem confiança mais baixa — ver comentário em `montarAtributo`.

type CallCtx = { sb: any; canal: ShopeeChannel }

async function callOpts(ctx: CallCtx) {
  const { partnerId, partnerKey } = await getIntegracaoCredentials(ctx.sb)
  return { partnerId, partnerKey, accessToken: ctx.canal.accessToken, shopId: ctx.canal.sellerId }
}

export type CategoriaShopee = {
  category_id: number
  original_category_name: string
  has_children: boolean
}

export async function getCategoryTree(ctx: CallCtx, parentCategoryId?: number): Promise<CategoriaShopee[]> {
  const callOptions = await callOpts(ctx)
  const data = await shopeeGet('/api/v2/product/get_category', { language: 'pt-br' }, callOptions)
  const lista: any[] = data?.response?.category_list ?? []
  // A Shopee devolve a árvore inteira numa chamada só (não pagina por
  // parent_category_id) — filtra no cliente pra simular navegação em
  // cascata sem precisar guardar/cachear a árvore inteira no banco.
  const pai = parentCategoryId ?? 0
  return lista
    .filter((c: any) => (c.parent_category_id ?? 0) === pai)
    .map((c: any) => ({
      category_id: c.category_id,
      // display_category_name é o nome traduzido conforme o `language`
      // pedido; original_category_name é o nome "mestre" da categoria na
      // Shopee (normalmente em inglês) — por isso o display vem primeiro.
      original_category_name: c.display_category_name ?? c.original_category_name ?? `Categoria ${c.category_id}`,
      has_children: !!c.has_children,
    }))
}

export type AtributoShopee = {
  attribute_id: number
  attribute_name: string
  is_mandatory: boolean
  attribute_type: string // TEXT | DROP_DOWN | COMBO_BOX | MULTIPLE_SELECT_COMBO_BOX ...
  attribute_value_list: { value_id: number; original_value_name: string }[]
}

export async function getAttributeTree(ctx: CallCtx, categoryId: number): Promise<AtributoShopee[]> {
  const callOptions = await callOpts(ctx)
  const data = await shopeeGet('/api/v2/product/get_attribute_tree', { category_id: categoryId, language: 'pt-br' }, callOptions)
  const lista: any[] = data?.response?.attribute_list ?? []
  return lista.map((a: any) => ({
    attribute_id: a.attribute_id,
    attribute_name: a.display_attribute_name ?? a.attribute_name ?? a.original_attribute_name ?? `Atributo ${a.attribute_id}`,
    is_mandatory: !!(a.is_mandatory ?? a.mandatory_attribute),
    attribute_type: a.attribute_type ?? a.input_type ?? 'TEXT',
    attribute_value_list: (a.attribute_value_list ?? []).map((v: any) => ({
      value_id: v.value_id,
      original_value_name: v.display_value_name ?? v.original_value_name ?? String(v.value_id),
    })),
  }))
}

export type MarcaShopee = { brand_id: number; original_brand_name: string }

export async function getBrandList(ctx: CallCtx, categoryId: number): Promise<MarcaShopee[]> {
  const callOptions = await callOpts(ctx)
  const data = await shopeeGet('/api/v2/product/get_brand_list', { category_id: categoryId, offset: 0, page_size: 100, status: 1 }, callOptions)
  const lista: any[] = data?.response?.brand_list ?? []
  return lista.map((b: any) => ({ brand_id: b.brand_id, original_brand_name: b.display_brand_name ?? b.original_brand_name ?? `Marca ${b.brand_id}` }))
}

export type CanalLogisticaShopee = { logistic_id: number; logistic_name: string; enabled: boolean }

export async function getLogisticsChannels(ctx: CallCtx): Promise<CanalLogisticaShopee[]> {
  const callOptions = await callOpts(ctx)
  const data = await shopeeGet('/api/v2/logistics/get_channel_list', {}, callOptions)
  const lista: any[] = data?.response?.logistics_channel_list ?? []
  return lista.map((l: any) => ({
    logistic_id: l.logistics_channel_id ?? l.logistic_channel_id,
    logistic_name: l.logistics_channel_name ?? l.logistic_channel_name ?? `Canal ${l.logistics_channel_id}`,
    enabled: !!l.enabled,
  }))
}

// Baixa a imagem principal do produto (produto_imagens.url já é uma URL
// pública, mesma premissa já usada em outras partes do sistema) e reenvia
// pro media_space da Shopee. Retorna o image_id usado em add_item.
export async function uploadImageFromUrl(ctx: CallCtx, imageUrl: string): Promise<string> {
  const respImagem = await fetch(imageUrl)
  if (!respImagem.ok) throw new ShopeeApiError(`Não foi possível baixar a imagem do produto (status ${respImagem.status})`)
  const blob = await respImagem.blob()

  const callOptions = await callOpts(ctx)
  const formData = new FormData()
  formData.append('image', blob, 'produto.jpg')
  formData.append('scene', 'normal')

  const data = await shopeeUploadImage('/api/v2/media_space/upload_image', formData, callOptions)
  const imageId = data?.response?.image_info?.image_id
  if (!imageId) throw new ShopeeApiError('Shopee não retornou o image_id do upload', undefined, data)
  return imageId
}

export type AtributoInput = { attribute_id: number; value_id?: number; texto?: string }

// Formato do value_id (DROP_DOWN) está confirmado. Já o de atributo TEXT
// (texto livre) não apareceu documentado em nenhuma fonte consultada —
// `original_value_name` é o nome mais plausível dado o padrão do resto da
// API, mas não foi validado contra uma chamada real. Se a Shopee rejeitar,
// o erro dela (guardado sem reformular) vai indicar isso.
function montarAtributo(a: AtributoInput) {
  return {
    attribute_id: a.attribute_id,
    attribute_value_list: a.value_id != null
      ? [{ value_id: a.value_id }]
      : [{ original_value_name: a.texto ?? '' }],
  }
}

export type CriarAnuncioInput = {
  produtoId: string
  empresaId: string
  categoryId: number
  titulo: string
  descricao: string
  preco: number
  estoque: number
  pesoKg: number
  comprimentoCm?: number
  larguraCm?: number
  alturaCm?: number
  brandId?: number
  brandNome?: string
  atributos: AtributoInput[]
  logisticaHabilitada: number[] // logistic_id[]
  fotoUrl?: string | null
}

export type ResultadoCriarAnuncio =
  | { ok: true; anuncioId: string; itemId: string; warning?: string }
  | { ok: false; erro: string }

export async function criarAnuncio(sb: any, canal: ShopeeChannel, input: CriarAnuncioInput): Promise<ResultadoCriarAnuncio> {
  const ctx = { sb, canal }
  const callOptions = await callOpts(ctx)

  try {
    let imageIdList: string[] = []
    if (input.fotoUrl) {
      const imageId = await uploadImageFromUrl(ctx, input.fotoUrl)
      imageIdList = [imageId]
    }

    const body: Record<string, any> = {
      item_name: input.titulo,
      description: input.descricao,
      category_id: input.categoryId,
      price: input.preco,
      stock: input.estoque,
      weight: input.pesoKg,
      logistic_info: input.logisticaHabilitada.map(logistic_id => ({ logistic_id, enabled: true })),
    }
    if (imageIdList.length > 0) body.image = { image_id_list: imageIdList }
    if (input.comprimentoCm && input.larguraCm && input.alturaCm) {
      body.dimension = { package_length: input.comprimentoCm, package_width: input.larguraCm, package_height: input.alturaCm }
    }
    if (input.atributos.length > 0) body.attribute_list = input.atributos.map(montarAtributo)
    if (input.brandId != null) body.brand = { brand_id: input.brandId, original_brand_name: input.brandNome ?? '' }

    const resposta = await shopeePost('/api/v2/product/add_item', body, callOptions)
    const itemId = resposta?.response?.item_id
    if (!itemId) throw new ShopeeApiError('Shopee não retornou o item_id do anúncio criado', undefined, resposta)

    // Reaproveita o sync já existente pra puxar o anúncio de volta com os
    // dados reais (evita duplicar o mapeamento raw→marketplace_anuncios que
    // já existe em sync.ts) — depois vincula o produto, único caso em que
    // é correto setar produto_id na volta do sync (aqui é criação nossa, não
    // um anúncio de terceiro que já pudesse ter vínculo manual).
    const syncResultado = await syncSingleItem(sb, canal, String(itemId))
    if (!syncResultado.ok) {
      return { ok: true, anuncioId: '', itemId: String(itemId), warning: `Anúncio criado na Shopee (item ${itemId}), mas falhou ao sincronizar de volta: ${syncResultado.error}. Use "Sincronizar agora" na tela de Anúncios.` }
    }

    await sb.from('marketplace_anuncios').update({ produto_id: input.produtoId }).eq('id', syncResultado.anuncioId)

    if (input.pesoKg || input.comprimentoCm) {
      await sb.from('produtos').update({
        peso_kg: input.pesoKg || null,
        comprimento_cm: input.comprimentoCm || null,
        largura_cm: input.larguraCm || null,
        altura_cm: input.alturaCm || null,
      }).eq('id', input.produtoId)
    }

    return { ok: true, anuncioId: syncResultado.anuncioId, itemId: String(itemId) }
  } catch (e: any) {
    const erro = e instanceof ShopeeApiError ? e.message : (e?.message ?? 'Erro ao criar anúncio na Shopee')
    return { ok: false, erro }
  }
}
