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

type CategoriaShopeeFlat = CategoriaShopee & { parent_category_id: number }

// A Shopee devolve a árvore inteira numa chamada só (não pagina por
// parent_category_id) — busca crua reaproveitada tanto pra navegação em
// cascata (getCategoryTree) quanto pra dedução por palavras-chave.
async function buscarArvoreCompleta(ctx: CallCtx): Promise<CategoriaShopeeFlat[]> {
  const callOptions = await callOpts(ctx)
  const data = await shopeeGet('/api/v2/product/get_category', { language: 'pt-br' }, callOptions)
  const lista: any[] = data?.response?.category_list ?? []
  return lista.map((c: any) => ({
    category_id: c.category_id,
    // display_category_name é o nome traduzido conforme o `language`
    // pedido; original_category_name é o nome "mestre" da categoria na
    // Shopee (normalmente em inglês) — por isso o display vem primeiro.
    original_category_name: c.display_category_name ?? c.original_category_name ?? `Categoria ${c.category_id}`,
    has_children: !!c.has_children,
    parent_category_id: c.parent_category_id ?? 0,
  }))
}

export async function getCategoryTree(ctx: CallCtx, parentCategoryId?: number): Promise<CategoriaShopee[]> {
  const arvore = await buscarArvoreCompleta(ctx)
  const pai = parentCategoryId ?? 0
  return arvore.filter(c => c.parent_category_id === pai)
}

function montarCaminho(arvore: CategoriaShopeeFlat[], categoryId: number): CategoriaShopeeFlat[] {
  const porId = new Map(arvore.map(c => [c.category_id, c]))
  const caminho: CategoriaShopeeFlat[] = []
  let atual = porId.get(categoryId)
  while (atual) {
    caminho.unshift(atual)
    atual = atual.parent_category_id ? porId.get(atual.parent_category_id) : undefined
  }
  return caminho
}

const PALAVRAS_IGNORADAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'pra', 'sem', 'em', 'e', 'ou', 'a', 'o', 'as', 'os',
  'kit', 'un', 'unid', 'pc', 'pct', 'cm', 'mm', 'kg', 'ml', 'und', 'peca', 'pecas',
  // Palavras genéricas demais pra identificar categoria: aparecem em ramos
  // completamente diferentes da árvore. Sem isso, um produto da categoria
  // interna "ACESSORIOS HIDRAULICOS" casava com "Acessórios de Sutiã" só
  // pela palavra "acessórios" — e vencia sozinha, porque bastava 1 ponto.
  'acessorio', 'acessorios', 'outro', 'outros', 'outra', 'outras', 'geral', 'gerais',
  'diverso', 'diversos', 'produto', 'produtos', 'artigo', 'artigos', 'item', 'itens',
  'material', 'materiais', 'tipo', 'tipos', 'linha', 'uso', 'novo', 'nova',
])

function normalizarPalavras(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length > 2 && !PALAVRAS_IGNORADAS.has(p))
}

export type CaminhoCategoriaResolvido = { opcoesPorNivel: CategoriaShopee[][]; caminho: CategoriaShopee[]; resolvidoAteFolha: boolean }

function montarResolucao(arvore: CategoriaShopeeFlat[], folhaId: number): CaminhoCategoriaResolvido {
  const caminho = montarCaminho(arvore, folhaId)
  const opcoesPorNivel: CategoriaShopee[][] = []
  let paiAtual = 0
  for (const nivel of caminho) {
    opcoesPorNivel.push(arvore.filter(c => c.parent_category_id === paiAtual))
    paiAtual = nivel.category_id
  }
  return { opcoesPorNivel, caminho, resolvidoAteFolha: true }
}

// Ferramenta oficial da Shopee pra sugerir categoria a partir do nome do
// produto (aprendizado deles em cima de milhões de anúncios reais — muito
// mais confiável que qualquer heurística nossa). Usada como 1º fallback,
// antes da categoria "lembrada" e da dedução por palavras-chave.
export async function recomendarCategoria(ctx: CallCtx, itemName: string): Promise<CaminhoCategoriaResolvido | null> {
  const callOptions = await callOpts(ctx)
  const data = await shopeeGet('/api/v2/product/category_recommend', { item_name: itemName }, callOptions)
  const ids: number[] = data?.response?.category_id_list ?? []
  if (ids.length === 0) return null

  const arvore = await buscarArvoreCompleta(ctx)
  const porId = new Set(arvore.map(c => c.category_id))
  const primeiraValida = ids.find(id => porId.has(id))
  if (primeiraValida == null) return null

  return montarResolucao(arvore, primeiraValida)
}

// Pré-seleção de categoria por dedução (sem IA): pontua cada categoria-folha
// da árvore inteira pela sobreposição de palavras entre o nome/categoria do
// produto e o nome da própria categoria + seus ancestrais (ex: produto
// "Lima kit 6 peças" bate com a folha "Lixas, Lixadeiras..." só se alguma
// palavra do produto aparecer ali ou em algum nível acima). Pontuação por
// tamanho da palavra (palavras mais longas/específicas pesam mais) reduz
// falsos positivos de palavras curtas genéricas.
export async function deduzirCategoriaPorPalavras(ctx: CallCtx, produtoNome: string, produtoCategoria?: string | null): Promise<CaminhoCategoriaResolvido | null> {
  const arvore = await buscarArvoreCompleta(ctx)
  const folhas = arvore.filter(c => !c.has_children)
  if (folhas.length === 0) return null

  const palavrasNome = new Set(normalizarPalavras(produtoNome))
  const palavrasCategoriaInterna = new Set(normalizarPalavras(produtoCategoria ?? ''))
  if (palavrasNome.size === 0 && palavrasCategoriaInterna.size === 0) return null

  let melhor: { folha: CategoriaShopeeFlat; pontos: number } | null = null
  for (const folha of folhas) {
    const caminhoAncestral = montarCaminho(arvore, folha.category_id)
    const palavrasCategoria = new Set(caminhoAncestral.flatMap(c => normalizarPalavras(c.original_category_name)))
    let pontos = 0
    let bateuNoNome = false
    // O nome do produto pesa o dobro da categoria interna: é o que descreve o
    // item de verdade. A categoria interna é da organização da loja e usa
    // vocabulário próprio, que nem sempre conversa com a árvore da Shopee.
    for (const p of palavrasNome) if (palavrasCategoria.has(p)) { pontos += p.length * 2; bateuNoNome = true }
    for (const p of palavrasCategoriaInterna) if (!palavrasNome.has(p) && palavrasCategoria.has(p)) pontos += p.length
    // Exige que ao menos uma palavra do NOME tenha batido. Casar só pela
    // categoria interna produzia sugestões absurdas com aparência de acerto
    // (a tela mostra o caminho com ✓), o que é pior do que não sugerir nada.
    if (bateuNoNome && pontos >= 8 && (!melhor || pontos > melhor.pontos)) melhor = { folha, pontos }
  }
  if (!melhor) return null

  return montarResolucao(arvore, melhor.folha.category_id)
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
  // A Shopee rejeitava com "CategoryIdList is required" quando o parâmetro
  // era enviado como category_id — o nome real esperado pela API atual é
  // category_id_list (aceita uma lista, mas um id só já funciona como valor único).
  const data = await shopeeGet('/api/v2/product/get_attribute_tree', { category_id_list: categoryId, language: 'pt-br' }, callOptions)
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
  fotoUrls: string[] // até 9 — limite da Shopee
}

export type ResultadoCriarAnuncio =
  | { ok: true; anuncioId: string; itemId: string; warning?: string }
  | { ok: false; erro: string }

export async function criarAnuncio(sb: any, canal: ShopeeChannel, input: CriarAnuncioInput): Promise<ResultadoCriarAnuncio> {
  const ctx = { sb, canal }
  const callOptions = await callOpts(ctx)

  try {
    const imageIdList: string[] = []
    for (const url of input.fotoUrls.slice(0, 9)) {
      imageIdList.push(await uploadImageFromUrl(ctx, url))
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
