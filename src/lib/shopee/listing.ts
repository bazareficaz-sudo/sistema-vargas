import { shopeeGet, shopeePost, shopeeUploadImage, getIntegracaoCredentials } from './client'
import { garantirFormatoAceito } from '@/lib/imagens/converter'
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

// Monta o caminho completo (e as opções de cada nível, pros selects da tela)
// a partir de um category_id já conhecido. Usado ao replicar um anúncio de
// outra conta Shopee: o id da categoria é da plataforma, não da conta, então
// vale igual nas duas — não precisa adivinhar de novo.
export async function resolverCaminhoPorCategoria(ctx: CallCtx, categoryId: number): Promise<CaminhoCategoriaResolvido | null> {
  const arvore = await buscarArvoreCompleta(ctx)
  const alvo = arvore.find(c => c.category_id === categoryId)
  if (!alvo) return null
  return montarResolucao(arvore, categoryId)
}

// Ferramenta oficial da Shopee pra sugerir categoria a partir do nome do
// produto (aprendizado deles em cima de milhões de anúncios reais — muito
// mais confiável que qualquer heurística nossa). Usada como 1º fallback,
// antes da categoria "lembrada" e da dedução por palavras-chave.
export async function recomendarCategoria(ctx: CallCtx, itemName: string): Promise<CaminhoCategoriaResolvido | null> {
  const callOptions = await callOpts(ctx)
  const data = await shopeeGet('/api/v2/product/category_recommend', { item_name: itemName }, callOptions)
  // A resposta traz `category_id` (um array, apesar do nome no singular),
  // ordenado da melhor sugestão para a pior. Lia-se `category_id_list`, que
  // não existe — a sugestão oficial nunca chegava a ser usada, e a tela caía
  // sempre na dedução por palavra-chave sem dizer nada.
  const ids: number[] = data?.response?.category_id ?? data?.response?.category_id_list ?? []
  if (ids.length === 0) return null

  const arvore = await buscarArvoreCompleta(ctx)
  const porId = new Map(arvore.map(c => [c.category_id, c]))
  // Só folha serve: a Shopee mistura categorias-pai na lista, e pedir os
  // atributos de uma categoria-pai é recusado ("should use leaf category").
  const escolhida = ids.find(id => porId.get(id) && !porId.get(id)!.has_children)
    ?? ids.find(id => porId.has(id))
  if (escolhida == null) return null

  return montarResolucao(arvore, escolhida)
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

// Tipos de entrada da Shopee (campo attribute_info.input_type), confirmados
// contra a resposta real da categoria 100719:
//   1 → escolha única, só valores da lista
//   2 → lista com opção de digitar um valor próprio
//   3 → texto/número livre (pode exigir unidade, ver `quantitativo`)
//   4 → múltipla escolha, só valores da lista
//   5 → múltipla escolha com opção de digitar
export const ENTRADA = { LISTA: 1, LISTA_OU_TEXTO: 2, TEXTO: 3, MULTI: 4, MULTI_OU_TEXTO: 5 } as const

export type ValorAtributoShopee = {
  value_id: number
  original_value_name: string
  // Atributos que só passam a existir quando ESTE valor é escolhido. Em
  // "Cabos Elétricos = Sim", por exemplo, aparece o número de registro do
  // INMETRO, também obrigatório. Ignorar isso é o que fazia a publicação
  // ser recusada sem que houvesse campo na tela para corrigir.
  filhos: AtributoShopee[]
}

export type AtributoShopee = {
  attribute_id: number
  attribute_name: string
  is_mandatory: boolean
  input_type: number
  quantitativo: boolean // format_type 2 — o valor vai acompanhado de unidade
  unidades: string[]
  attribute_value_list: ValorAtributoShopee[]
}

// Nome em português quando a Shopee manda a tradução; senão o nome original.
function nomeTraduzido(no: any, fallback: string): string {
  const pt = (no?.multi_lang ?? []).find((m: any) => m.language === 'pt-BR' || m.language === 'pt-br')
  return pt?.value ?? no?.display_attribute_name ?? no?.display_value_name ?? fallback
}

function mapearAtributo(a: any): AtributoShopee {
  const info = a.attribute_info ?? {}
  return {
    attribute_id: a.attribute_id,
    attribute_name: nomeTraduzido(a, a.name ?? a.original_attribute_name ?? `Atributo ${a.attribute_id}`),
    is_mandatory: !!(a.mandatory ?? a.is_mandatory ?? a.mandatory_attribute),
    input_type: Number(info.input_type ?? a.input_type ?? ENTRADA.TEXTO),
    quantitativo: Number(info.format_type ?? 1) === 2,
    unidades: info.attribute_unit_list ?? info.unit_list ?? [],
    attribute_value_list: (a.attribute_value_list ?? []).map((v: any) => ({
      value_id: v.value_id,
      original_value_name: nomeTraduzido(v, v.name ?? v.original_value_name ?? String(v.value_id)),
      filhos: (v.child_attribute_list ?? []).map(mapearAtributo),
    })),
  }
}

export async function getAttributeTree(ctx: CallCtx, categoryId: number): Promise<AtributoShopee[]> {
  const callOptions = await callOpts(ctx)
  // A Shopee rejeitava com "CategoryIdList is required" quando o parâmetro
  // era enviado como category_id — o nome real esperado pela API atual é
  // category_id_list (aceita uma lista, mas um id só já funciona como valor único).
  const data = await shopeeGet('/api/v2/product/get_attribute_tree', { category_id_list: categoryId, language: 'pt-br' }, callOptions)

  // A resposta vem como response.list[].attribute_tree — um nó por categoria
  // pedida. O caminho antigo (response.attribute_list) não existe, e por isso
  // a lista chegava SEMPRE vazia: nenhuma categoria mostrava atributo nenhum
  // na tela, e só se descobria isso quando a Shopee recusava a publicação por
  // faltar um obrigatório.
  const no = (data?.response?.list ?? [])[0]
  if (no?.warning) {
    // Acontece quando a categoria escolhida não é folha — a Shopee não
    // devolve atributos e explica o porquê. Repassar em vez de engolir.
    throw new ShopeeApiError(`Shopee: ${no.warning}`, undefined, data)
  }
  const lista: any[] = no?.attribute_tree ?? data?.response?.attribute_list ?? []
  return lista.map(mapearAtributo)
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

  // A Shopee recusa WebP com "image is invalid or not supported". O código
  // anterior mandava o arquivo chamado "produto.jpg", mas o nome não muda os
  // bytes — a Shopee lê o conteúdo. Aqui a imagem é convertida de verdade
  // quando o formato não serve, e reduzida quando passa dos 5 MB do limite.
  const original = await respImagem.arrayBuffer()
  const img = await garantirFormatoAceito(original)

  const callOptions = await callOpts(ctx)
  const formData = new FormData()
  formData.append('image', new Blob([new Uint8Array(img.buffer)], { type: img.contentType }), img.nomeArquivo)
  formData.append('scene', 'normal')

  const data = await shopeeUploadImage('/api/v2/media_space/upload_image', formData, callOptions)
  const imageId = data?.response?.image_info?.image_id
  if (!imageId) throw new ShopeeApiError('Shopee não retornou o image_id do upload', undefined, data)
  return imageId
}

export type AtributoInput = {
  attribute_id: number
  value_id?: number
  valueIds?: number[]  // múltipla escolha
  texto?: string
  unidade?: string     // atributos quantitativos (ex.: Tensão em V)
  inputType?: number   // ENTRADA.* — define se texto livre é aceito
}

/**
 * Monta um item de `attribute_list`.
 *
 * O valor de texto livre vai com `value_id: 0`. Isso não é enfeite: a Shopee
 * recusou uma publicação real com
 *
 *   invalid AttributeValue.ValueId: ValueId is required
 *
 * quando o texto foi enviado sem esse campo. O zero é o que marca o valor
 * como "digitado pelo vendedor" em vez de escolhido da lista dela.
 */
function montarAtributo(a: AtributoInput) {
  const valores: any[] = []

  if (a.valueIds?.length) {
    for (const id of a.valueIds) valores.push({ value_id: id })
  } else if (a.value_id != null) {
    valores.push({ value_id: a.value_id })
  }

  // Atributo que só aceita escolha da lista não pode receber texto livre.
  // Quem costuma cair aqui é o preenchimento por IA, que às vezes devolve o
  // rótulo em vez do id — e a Shopee recusaria o anúncio inteiro por causa
  // de um campo. Melhor publicar sem esse atributo do que não publicar.
  const soLista = a.inputType === ENTRADA.LISTA || a.inputType === ENTRADA.MULTI

  if (a.texto?.trim() && !soLista) {
    const v: any = { value_id: 0, original_value_name: a.texto.trim() }
    if (a.unidade) v.value_unit = a.unidade
    valores.push(v)
  }

  return { attribute_id: a.attribute_id, attribute_value_list: valores }
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
  condicao?: 'NEW' | 'USED'
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
      // Nomes exigidos pela versão atual da API: `price`/`stock` (planos, do
      // formato antigo) são recusados com "invalid field seller_stock, value
      // must Not Null". É o mesmo formato que update_price/update_stock em
      // write.ts já usam com sucesso em produção.
      original_price: input.preco,
      seller_stock: [{ stock: input.estoque }],
      weight: input.pesoKg,
      // Obrigatório no add_item. Sem ele a Shopee recusa o anúncio inteiro
      // com "Parameter is not match the constraints, . : condition is
      // required" — mensagem que não diz qual campo falta.
      condition: input.condicao ?? 'NEW',
      logistic_info: input.logisticaHabilitada.map(logistic_id => ({ logistic_id, enabled: true })),
    }
    if (imageIdList.length > 0) body.image = { image_id_list: imageIdList }
    if (input.comprimentoCm && input.larguraCm && input.alturaCm) {
      body.dimension = { package_length: input.comprimentoCm, package_width: input.larguraCm, package_height: input.alturaCm }
    }
    // Atributo que sobrou sem valor nenhum não vai. Mandar um item com
    // `attribute_value_list` vazio é outro jeito de a Shopee recusar o
    // anúncio inteiro por validação.
    const atributosMontados = input.atributos
      .map(montarAtributo)
      .filter(a => a.attribute_value_list.length > 0)
    if (atributosMontados.length > 0) body.attribute_list = atributosMontados
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

// ── Edição de anúncio já publicado ─────────────────────────────────────────
//
// `update_item` é o mesmo endpoint para tudo que é conteúdo: nome, descrição,
// fotos, atributos, marca, peso, medidas e SKU. Preço e estoque NÃO passam
// por aqui de propósito — quem cuida deles é `write.ts` (update_price e
// update_stock), que a fila já usa e que sabe lidar com variação. Misturar as
// duas coisas faria uma edição de texto arriscar o preço do anúncio.
//
// Campo ausente = campo não alterado. Isso não é detalhe de implementação: é
// o que permite salvar só a ordem das fotos sem reenviar a descrição inteira.

export type AtualizarAnuncioInput = {
  itemId: number
  titulo?: string
  descricao?: string
  /** Fotos na ordem final. A que já está na Shopee vem com `idExterno`; a
   *  nova vem só com `url` e sobe agora. A primeira da lista é a capa. */
  imagens?: { url: string; idExterno: string | null }[]
  atributos?: AtributoInput[]
  brandId?: number
  brandNome?: string
  pesoKg?: number
  comprimentoCm?: number
  larguraCm?: number
  alturaCm?: number
  skuCanal?: string
  /** `description_type` do anúncio. A Shopee recusa `description` em item
   *  com descrição estendida (a de blocos, com imagem no meio) — nesse caso
   *  o texto é ignorado e o aviso volta para a tela, em vez de a edição
   *  inteira ser recusada por causa de um campo. */
  tipoDescricao?: string | null
}

export type ResultadoAtualizarAnuncio =
  | { ok: true; avisos: string[] }
  | { ok: false; erro: string }

export async function atualizarAnuncio(
  sb: any, canal: ShopeeChannel, input: AtualizarAnuncioInput,
): Promise<ResultadoAtualizarAnuncio> {
  const ctx = { sb, canal }
  const avisos: string[] = []

  try {
    const callOptions = await callOpts(ctx)
    const body: Record<string, any> = { item_id: input.itemId }

    if (input.titulo?.trim()) body.item_name = input.titulo.trim()

    if (input.descricao != null) {
      if (input.tipoDescricao === 'extended') {
        avisos.push('A descrição não foi enviada: este anúncio usa descrição estendida na Shopee, que só pode ser editada lá.')
      } else {
        body.description = input.descricao
      }
    }

    if (input.imagens) {
      const imageIdList: string[] = []
      for (const img of input.imagens.slice(0, 9)) {
        // Foto que já está na Shopee só muda de posição — reenviá-la geraria
        // um id novo, um arquivo duplicado no media_space e uma chamada de
        // upload por foto a cada troca de capa.
        if (img.idExterno) { imageIdList.push(img.idExterno); continue }
        imageIdList.push(await uploadImageFromUrl(ctx, img.url))
      }
      if (imageIdList.length === 0) {
        return { ok: false, erro: 'O anúncio precisa de pelo menos uma foto.' }
      }
      body.image = { image_id_list: imageIdList }
      if (input.imagens.length > 9) {
        avisos.push(`A Shopee aceita 9 fotos por anúncio — as ${input.imagens.length - 9} últimas ficaram de fora.`)
      }
    }

    if (input.atributos) {
      // Mesma regra do add_item: atributo sem valor nenhum não vai, senão a
      // Shopee recusa o item inteiro por validação.
      const montados = input.atributos.map(montarAtributo).filter(a => a.attribute_value_list.length > 0)
      body.attribute_list = montados
    }

    if (input.brandId != null) body.brand = { brand_id: input.brandId, original_brand_name: input.brandNome ?? '' }
    if (input.pesoKg != null && input.pesoKg > 0) body.weight = input.pesoKg
    if (input.comprimentoCm && input.larguraCm && input.alturaCm) {
      body.dimension = {
        package_length: input.comprimentoCm, package_width: input.larguraCm, package_height: input.alturaCm,
      }
    }
    if (input.skuCanal != null) body.item_sku = input.skuCanal

    // Só `item_id` significa que nada mudou — não gasta chamada.
    if (Object.keys(body).length === 1) return { ok: true, avisos }

    await shopeePost('/api/v2/product/update_item', body, callOptions)
    return { ok: true, avisos }
  } catch (e: any) {
    const erro = e instanceof ShopeeApiError ? e.message : (e?.message ?? 'Erro ao atualizar o anúncio na Shopee')
    return { ok: false, erro }
  }
}
