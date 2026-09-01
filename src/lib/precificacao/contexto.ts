import { buscarConfigDoCanal, type FaixasSaude } from './config'
import { resolverFaixasML } from './mlComissao'
import {
  resolverFreteML, embalagemDoAnuncio, logisticTypeDoAnuncio, listingTypeDoAnuncio, pesoCobravelML,
} from './mlFrete'
import { resolverPrecoEfetivo, type PrecoResolvido } from './precos'
import { normalizarCampanhaDoEspelho, type CampanhaDoAnuncio } from './campanhas'
import { calcularKit } from '@/lib/produtos/kit'
import { refreshAccessTokenIfNeeded } from '@/lib/mercadolivre/client'
import type { MLChannel } from '@/lib/mercadolivre/types'
import type { ConfigTaxas, FaixaComissao, FaixaFrete } from './tipos'
import type { EconomiaResolvida } from './cenarios'

// CONTEXTO DE PRECIFICAÇÃO — a fonte única de verdade da economia de um item.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// Até a Fase 1, cada rota montava a própria economia, e elas discordavam.
// Medido no código em 28/08/2026:
//
//   `resolverFaixasML` (comissão real do ML) aparecia SÓ em
//   `api/precificacao/simular` — e, pior, num ramo inalcançável: a rota só
//   consulta a API se receber `categoriaML` no corpo, e nenhum cliente
//   enviava esse campo. Na prática a comissão medida do Mercado Livre NUNCA
//   era usada, em tela nenhuma.
//
//   `resolverFreteML` (frete real do ML) aparecia no recálculo em massa e no
//   ajustar-item, mas não no simulador nem no explicar.
//
// Resultado: o mesmo anúncio saía com números diferentes dependendo da tela.
// Agora todos passam por aqui.
//
// O QUE ESTE ARQUIVO NÃO FAZ
//
// Não calcula. Ele resolve INSUMOS (config do canal, custo, comissão, frete)
// e entrega uma `EconomiaResolvida` para `cenarios.ts` chamar o motor. O
// motor continua puro e síncrono — nada daqui entra nele.

// O cliente do Supabase é `any` em todo o repositório: tipá-lo exigiria os
// tipos gerados do banco, que este projeto não usa. O alias existe para a
// exceção ficar declarada em UM lugar, em vez de repetida em cada assinatura.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any

// O payload cru do marketplace não tem forma conhecida — é o JSON que a
// plataforma devolveu, e quem o lê (`embalagemDoAnuncio`, `logisticType...`)
// já trata campo ausente.
type DadosBrutos = unknown

export const COLUNAS_CANAL =
  'id, nome, plataforma, empresa_id, seller_id, access_token, refresh_token, token_expira_em'

// `estoque` entra aqui por causa do sinal comercial da Fase 3 — é a entrada
// de `estoqueDoSistema`, que decide o número que vale para o marketplace.
export const COLUNAS_PRODUTO =
  'id, nome, sku, categoria, marca, tipo, preco_custo, preco_venda, estoque, peso_kg, comprimento_cm, largura_cm, altura_cm'

export const COLUNAS_ANUNCIO =
  'id, canal_id, produto_id, id_externo, titulo, preco_venda, preco_promocional, promo_inicio, promo_fim, status, tem_variacao, categoria_externa, dados_brutos'

export type CanalPrecificacao = {
  id: string
  nome: string
  plataforma: string
  empresa_id?: string
  seller_id?: string | number | null
  access_token?: string | null
  refresh_token?: string | null
  token_expira_em?: string | null
}

export type ProdutoPrecificacao = {
  id: string
  nome?: string | null
  sku?: string | null
  categoria?: string | null
  marca?: string | null
  tipo?: string | null
  preco_custo?: number | null
  peso_kg?: number | null
  comprimento_cm?: number | null
  largura_cm?: number | null
  altura_cm?: number | null
}

export type AnuncioPrecificacao = {
  id: string
  canal_id?: string
  id_externo?: string | null
  titulo?: string | null
  preco_venda?: number | null
  preco_promocional?: number | null
  promo_inicio?: string | null
  promo_fim?: string | null
  tem_variacao?: boolean | null
  categoria_externa?: string | null
  dados_brutos?: DadosBrutos
}

/** De onde saiu o custo usado na conta. */
export type OrigemCusto = 'produto' | 'kit' | 'manual'

/** De onde saiu a comissão usada na conta. */
export type OrigemComissao =
  | 'tabela'                // faixas cadastradas na tela
  | 'simples'               // percentual único cadastrado
  | 'api_ml'                // medida na API do Mercado Livre agora
  | 'api_ml_cache'          // medida na API, servida do cache
  | 'api_ml_sem_categoria'  // pedimos a API mas não sabemos a categoria
  | 'api_ml_indisponivel'   // a consulta falhou

/** De onde saiu o frete usado na conta. */
export type OrigemFrete =
  | 'config'                // o modo de frete cadastrado na tela
  | 'api_ml'                // escada medida na API agora
  | 'api_ml_cache'          // escada medida na API, servida do cache
  | 'api_ml_sem_medidas'    // sem peso/dimensão em lugar nenhum
  | 'api_ml_indisponivel'   // a consulta falhou

export type ContextoPrecificacao = {
  empresaId: string
  canal: { id: string; nome: string; plataforma: string }
  produto: ProdutoPrecificacao | null
  anuncio: AnuncioPrecificacao | null

  /**
   * Preços do anúncio pelo vocabulário canônico, já considerando a campanha
   * real da plataforma quando existe uma vigente.
   */
  precos: PrecoResolvido | null
  /** Campanhas do canal que tocam este anúncio, vigentes ou não. */
  campanhas: CampanhaDoAnuncio[]

  origemConfig: 'canal' | 'plataforma' | 'preset'
  origemCusto: OrigemCusto
  origemComissao: OrigemComissao
  origemFrete: OrigemFrete

  /** O que o motor consome. Nada aqui depende de banco ou rede. */
  economia: EconomiaResolvida

  /**
   * Um só instante para todo o contexto. Numa varredura de milhares de
   * anúncios, o item da última página tem de ser avaliado contra o mesmo
   * relógio do item da primeira — senão uma promoção que vence no meio da
   * fila produz dois resultados na mesma execução.
   */
  resolvidoEm: Date

  avisos: string[]
}

type Resolvedor = {
  /** Instante único desta resolução — reaproveitado por todo o lote. */
  agora: Date
  /**
   * Só o custo, sem tocar em API nenhuma.
   *
   * Existe porque o custo é a primeira peneira da varredura: anúncio sem
   * custo não vira preço, e descobrir isso não pode custar uma consulta de
   * comissão ao Mercado Livre.
   */
  custo(produto: ProdutoPrecificacao): Promise<{ custo: number; origem: OrigemCusto }>
  /** Campanhas não encerradas do canal, já normalizadas. Uma consulta por canal. */
  campanhas(canal: CanalPrecificacao): Promise<CampanhaDoAnuncio[]>
  contexto(entrada: {
    canal: CanalPrecificacao
    produto?: ProdutoPrecificacao | null
    anuncio?: AnuncioPrecificacao | null
    custoManual?: number | null
  }): Promise<ContextoPrecificacao>
}

/**
 * Cria um resolvedor com memória.
 *
 * As caches são POR EXECUÇÃO, não globais: uma varredura de 9 mil anúncios
 * resolve a configuração de cada canal uma vez, a comissão de cada categoria
 * uma vez e o frete de cada peso cobrável uma vez. Fora da execução nada
 * sobrevive — o cache de verdade é o do banco (12 h para comissão, 24 h para
 * frete).
 */
export function criarResolvedor(sb: ClienteSupabase, empresaId: string, agora: Date = new Date()): Resolvedor {
  const configPorCanal = new Map<string, { cfg: ConfigTaxas & { faixasSaude: FaixasSaude }; origem: 'canal' | 'plataforma' | 'preset' }>()
  const custoPorProduto = new Map<string, number>()
  const canalAutenticado = new Map<string, CanalPrecificacao | null>()
  const comissaoPorChave = new Map<string, { faixas: FaixaComissao[]; origem: 'api' | 'cache' } | null>()
  const fretePorChave = new Map<string, { faixas: FaixaFrete[]; origem: 'api' | 'cache' } | null>()
  const campanhasPorCanal = new Map<string, CampanhaDoAnuncio[]>()

  // Campanhas do canal — uma consulta por canal, não por anúncio.
  //
  // Vem do ESPELHO LOCAL (`marketplace_promocoes`), nunca da API: a tela não
  // pode chamar marketplace nenhum ao abrir. A contrapartida é que o espelho
  // envelhece, e a sincronização de campanhas ainda é manual neste sistema —
  // por isso `vigenciaDaCampanha` confia na JANELA e não no status.
  async function campanhasDoCanal(canal: CanalPrecificacao): Promise<CampanhaDoAnuncio[]> {
    const guardado = campanhasPorCanal.get(canal.id)
    if (guardado) return guardado

    const { data } = await sb
      .from('marketplace_promocoes')
      .select(`
        id, empresa_id, canal_id, id_externo, nome, status, inicio, fim, sincronizado_em, dados_brutos,
        marketplace_promocao_itens (
          id, anuncio_id, item_id_externo, model_id,
          preco_original, preco_promocional, limite_por_compra, estoque_promocao
        )
      `)
      // Empresa E canal: a campanha é da empresa da sessão, e id de canal
      // nunca é identificador suficiente sozinho.
      .eq('empresa_id', empresaId)
      .eq('canal_id', canal.id)
      // Campanha encerrada não muda preço nenhum e só faria a consulta
      // crescer com histórico.
      .neq('status', 'encerrada')

    const normalizadas = (data ?? []).map((linha: Record<string, unknown>) =>
      normalizarCampanhaDoEspelho(linha as never, canal, empresaId))
    campanhasPorCanal.set(canal.id, normalizadas)
    return normalizadas
  }

  async function config(canal: CanalPrecificacao) {
    const guardado = configPorCanal.get(canal.id)
    if (guardado) return guardado
    const r = await buscarConfigDoCanal(sb, empresaId, canal)
    configPorCanal.set(canal.id, r)
    return r
  }

  // Custo do produto, com kit somado a partir dos componentes. Kit é caro:
  // uma consulta por componente, então nunca mais de uma vez por produto.
  async function custoDoProduto(produto: ProdutoPrecificacao): Promise<{ custo: number; origem: OrigemCusto }> {
    if (produto.tipo !== 'kit') return { custo: Number(produto.preco_custo ?? 0), origem: 'produto' }
    if (!custoPorProduto.has(produto.id)) {
      custoPorProduto.set(produto.id, Number((await calcularKit(sb, produto.id))?.custo ?? 0))
    }
    return { custo: custoPorProduto.get(produto.id)!, origem: 'kit' }
  }

  // Token renovado uma vez por canal. Canal sem credencial devolve null, e
  // quem chama cai no valor configurado — nunca numa exceção.
  async function autenticar(canal: CanalPrecificacao): Promise<CanalPrecificacao | null> {
    if (canalAutenticado.has(canal.id)) return canalAutenticado.get(canal.id)!
    let saida: CanalPrecificacao | null = null
    if (canal.plataforma === 'mercadolivre' && canal.access_token && canal.seller_id) {
      try {
        const paraRenovar: MLChannel = {
          id: canal.id,
          empresaId: canal.empresa_id ?? empresaId,
          sellerId: String(canal.seller_id),
          accessToken: canal.access_token,
          refreshToken: canal.refresh_token ?? '',
          tokenExpiraEm: canal.token_expira_em ?? null,
        }
        const atualizado = await refreshAccessTokenIfNeeded(sb, paraRenovar)
        saida = { ...canal, access_token: atualizado.accessToken ?? canal.access_token }
      } catch {
        saida = null
      }
    }
    canalAutenticado.set(canal.id, saida)
    return saida
  }

  // ── Comissão ──────────────────────────────────────────────────────────────
  //
  // Só o Mercado Livre tem medição por API. A categoria vem do anúncio
  // (`categoria_externa`, gravada pelo sync) — sem anúncio não há categoria, e
  // aí a tabela configurada é o melhor que existe. Isso é dito em voz alta no
  // aviso, em vez de o número sair como se fosse medido.
  async function comissao(
    canal: CanalPrecificacao,
    cfg: ConfigTaxas,
    anuncio: AnuncioPrecificacao | null,
  ): Promise<{ cfg: ConfigTaxas; origem: OrigemComissao; aviso?: string }> {
    if (cfg.comissaoModo === 'simples') return { cfg, origem: 'simples' }
    if (cfg.comissaoModo !== 'api_ml' || canal.plataforma !== 'mercadolivre') return { cfg, origem: 'tabela' }

    const categoria = anuncio?.categoria_externa ?? null
    const semApi = { ...cfg, comissaoModo: 'faixas' as const }
    if (!categoria) {
      return {
        cfg: semApi, origem: 'api_ml_sem_categoria',
        aviso: 'Sem a categoria do Mercado Livre (o produto não tem anúncio neste canal), a comissão usada é a da tabela configurada — não a alíquota real da categoria.',
      }
    }

    const listingType = listingTypeDoAnuncio(anuncio?.dados_brutos)
    const chave = `${canal.id}|${categoria}|${listingType}`
    if (!comissaoPorChave.has(chave)) {
      const autenticado = await autenticar(canal)
      if (!autenticado?.access_token) {
        comissaoPorChave.set(chave, null)
      } else {
        try {
          const r = await resolverFaixasML(sb, { id: canal.id, accessToken: autenticado.access_token }, categoria, listingType)
          comissaoPorChave.set(chave, { faixas: r.faixas, origem: r.origem })
        } catch {
          comissaoPorChave.set(chave, null)
        }
      }
    }

    const achado = comissaoPorChave.get(chave)
    if (!achado?.faixas?.length) {
      return {
        cfg: semApi, origem: 'api_ml_indisponivel',
        aviso: 'Não foi possível consultar a comissão real no Mercado Livre — usando a tabela configurada.',
      }
    }
    return {
      cfg: { ...cfg, comissaoModo: 'faixas', comissaoFaixas: achado.faixas },
      origem: achado.origem === 'cache' ? 'api_ml_cache' : 'api_ml',
    }
  }

  // ── Frete ─────────────────────────────────────────────────────────────────
  //
  // A escada real substitui o "custo médio" digitado. As medidas saem do
  // anúncio quando existem e do cadastro do produto como reserva — é por isso
  // que o simulador de um produto ainda sem anúncio também consegue frete
  // real, desde que o cadastro tenha dimensão e peso.
  async function frete(
    canal: CanalPrecificacao,
    cfg: ConfigTaxas,
    produto: ProdutoPrecificacao | null,
    anuncio: AnuncioPrecificacao | null,
  ): Promise<{ faixas: FaixaFrete[] | null; origem: OrigemFrete; aviso?: string }> {
    if (!cfg.freteMlImportar || canal.plataforma !== 'mercadolivre') return { faixas: null, origem: 'config' }

    const emb = embalagemDoAnuncio(anuncio?.dados_brutos, produto ?? undefined)
    if (!emb) {
      // O QUE ACONTECE DE VERDADE quando caímos aqui, que é diferente do que
      // este aviso dizia até 01/09/2026 ("frete pelo custo médio configurado"):
      // o cálculo passa a usar `cfg.freteModo`, e nos dois canais de ML deste
      // sistema esse modo é `gratis_acima`. Abaixo do limite ele devolve ZERO,
      // não o custo médio.
      //
      // E o zero é sabidamente falso. A medição de 29/08/2026 — a mesma que
      // fez `mlFrete.ts` sondar preços abaixo de R$ 79 — mostrou o vendedor
      // pagando R$ 6,95 na faixa de R$ 0 a R$ 49,99. A premissa "abaixo do
      // limite quem paga é o comprador" já foi derrubada com número.
      //
      // Não dá para inventar o frete deste item sem as medidas dele. Dá para
      // parar de chamar de "custo médio" o que é zero.
      const zeraAbaixoDoLimite = cfg.freteModo === 'gratis_acima'
      return {
        faixas: null, origem: 'api_ml_sem_medidas',
        aviso: zeraAbaixoDoLimite
          ? 'Sem peso/medidas no anúncio nem no cadastro: abaixo de '
            + `R$ ${(cfg.freteLimiteGratis ?? 0).toFixed(2).replace('.', ',')} o cálculo usa frete ZERO. `
            + 'Medições reais do Mercado Livre mostram frete cobrado do vendedor também abaixo desse '
            + 'limite — cadastre peso e dimensões do produto para o frete entrar na conta.'
          : 'Sem peso/medidas no anúncio nem no cadastro — frete pelo modo configurado no canal, não medido.',
      }
    }

    const logistica = logisticTypeDoAnuncio(anuncio?.dados_brutos)
    const tipoAnuncio = listingTypeDoAnuncio(anuncio?.dados_brutos)
    const chave = `${canal.id}|${pesoCobravelML(emb)}|${logistica}|${tipoAnuncio}`

    if (!fretePorChave.has(chave)) {
      const autenticado = await autenticar(canal)
      if (!autenticado?.access_token || !autenticado.seller_id) {
        fretePorChave.set(chave, null)
      } else {
        try {
          const r = await resolverFreteML(
            sb,
            { id: canal.id, sellerId: String(autenticado.seller_id), accessToken: autenticado.access_token },
            emb, logistica, tipoAnuncio,
          )
          fretePorChave.set(chave, { faixas: r.faixas, origem: r.origem })
        } catch {
          // Falha de consulta não derruba o lote: este item volta ao frete
          // configurado e os outros seguem.
          fretePorChave.set(chave, null)
        }
      }
    }

    const achado = fretePorChave.get(chave)
    if (!achado?.faixas?.length) {
      return {
        faixas: null, origem: 'api_ml_indisponivel',
        aviso: 'Não foi possível consultar o frete no Mercado Livre — usando o custo médio configurado.',
      }
    }
    return { faixas: achado.faixas, origem: achado.origem === 'cache' ? 'api_ml_cache' : 'api_ml' }
  }

  async function contexto(entrada: {
    canal: CanalPrecificacao
    produto?: ProdutoPrecificacao | null
    anuncio?: AnuncioPrecificacao | null
    custoManual?: number | null
  }): Promise<ContextoPrecificacao> {
    const { canal } = entrada
    const produto = entrada.produto ?? null
    const anuncio = entrada.anuncio ?? null
    const avisos: string[] = []

    const { cfg: cfgBase, origem: origemConfig } = await config(canal)
    if (origemConfig === 'preset') {
      avisos.push('Este canal ainda não tem taxas configuradas — os valores são um ponto de partida, confira antes de decidir.')
    }

    let custo = 0
    let origemCusto: OrigemCusto = 'manual'
    if (entrada.custoManual != null && entrada.custoManual > 0) {
      custo = Number(entrada.custoManual)
    } else if (produto) {
      const r = await custoDoProduto(produto)
      custo = r.custo
      origemCusto = r.origem
    }

    const comissaoResolvida = await comissao(canal, cfgBase, anuncio)
    if (comissaoResolvida.aviso) avisos.push(comissaoResolvida.aviso)

    const freteResolvido = await frete(canal, cfgBase, produto, anuncio)
    if (freteResolvido.aviso) avisos.push(freteResolvido.aviso)

    const cfgFinal = {
      ...comissaoResolvida.cfg,
      faixasSaude: cfgBase.faixasSaude,
    } as ConfigTaxas & { faixasSaude: FaixasSaude }

    // Campanhas só são consultadas quando há anúncio: sem anúncio não há item
    // de campanha para casar, e a consulta seria desperdício.
    const campanhas = anuncio ? await campanhasDoCanal(canal) : []
    const precos = anuncio
      ? resolverPrecoEfetivo({ anuncio: { ...anuncio, id: anuncio.id }, campanhas, agora })
      : null
    if (precos) avisos.push(...precos.avisos)

    return {
      empresaId,
      canal: { id: canal.id, nome: canal.nome, plataforma: canal.plataforma },
      produto,
      anuncio,
      precos,
      campanhas,
      origemConfig,
      origemCusto,
      origemComissao: comissaoResolvida.origem,
      origemFrete: freteResolvido.origem,
      economia: {
        cfg: cfgFinal,
        custo,
        pesoKg: produto?.peso_kg != null ? Number(produto.peso_kg) : null,
        freteFaixas: freteResolvido.faixas,
      },
      resolvidoEm: agora,
      avisos,
    }
  }

  return { agora, custo: custoDoProduto, campanhas: campanhasDoCanal, contexto }
}

/**
 * Como a economia deste contexto foi montada, em uma linha.
 *
 * Vai para a tela e para o histórico: "a comissão saiu da API do ML e o frete
 * do custo médio" é a diferença entre um número confiável e um palpite, e o
 * operador precisa conseguir ver qual dos dois está olhando.
 */
export function descreverOrigem(ctx: ContextoPrecificacao): string {
  const comissao: Record<OrigemComissao, string> = {
    tabela: 'comissão da tabela configurada',
    simples: 'comissão do percentual configurado',
    api_ml: 'comissão medida no Mercado Livre',
    api_ml_cache: 'comissão medida no Mercado Livre (cache)',
    api_ml_sem_categoria: 'comissão da tabela (categoria do ML desconhecida)',
    api_ml_indisponivel: 'comissão da tabela (consulta ao ML falhou)',
  }
  const frete: Record<OrigemFrete, string> = {
    config: 'frete conforme configurado',
    api_ml: 'frete medido no Mercado Livre',
    api_ml_cache: 'frete medido no Mercado Livre (cache)',
    // "custo médio" era otimista: com `gratis_acima` abaixo do limite o valor
    // usado é zero. O rótulo diz o que é — não medido — em vez de nomear um
    // número que pode não ter entrado na conta.
    api_ml_sem_medidas: 'frete NÃO medido (produto sem peso/dimensões)',
    api_ml_indisponivel: 'frete NÃO medido (consulta ao ML falhou)',
  }
  const custo: Record<OrigemCusto, string> = {
    produto: 'custo do cadastro',
    kit: 'custo somado dos componentes do kit',
    manual: 'custo informado à mão',
  }
  return [custo[ctx.origemCusto], comissao[ctx.origemComissao], frete[ctx.origemFrete]].join(' · ')
}
