// MODELO CANÔNICO DE CAMPANHA — camada PURA.
//
// A tela não pode precisar saber que "promoção da Shopee é assim" e "do
// Mercado Livre é assado". Este arquivo define o formato único e as regras de
// vigência; os adaptadores traduzem cada plataforma para cá.
//
// O QUE FOI REAPROVEITADO (auditado em 29/08/2026)
//
// Nenhuma tabela nova. `marketplace_promocoes` e `marketplace_promocao_itens`
// já cobrem quase todo o modelo:
//
//   campanha  id_externo · nome · inicio · fim · status · dados_brutos
//   item      anuncio_id · item_id_externo · model_id · preco_original ·
//             preco_promocional · limite_por_compra · estoque_promocao
//
// Faltam `plataforma` e `tipo` na campanha. Enquanto só a Shopee alimenta a
// tabela, a plataforma é derivável do canal — então NÃO foi criada coluna.
// Quando o Mercado Livre entrar, essa derivação continua valendo, porque a
// campanha pertence a um canal e o canal tem plataforma.
//
// O QUE ESTE ARQUIVO NÃO FAZ
//
// Não calcula margem. Campanha propõe um preço; quem diz quanto sobra é
// `avaliarPreco`. Não fala com API nenhuma: recebe linhas do espelho local.

export type StatusCampanha = 'rascunho' | 'programada' | 'ativa' | 'encerrada'

export type CampanhaCanonica = {
  id: string
  empresaId: string
  canalId: string
  plataforma: string
  /** `discount_id` da Shopee, `promotion_id` do ML. Nulo se só existe aqui. */
  idExterno: string | null
  nome: string
  /** Tipo da plataforma (DEAL, SELLER_CAMPAIGN...). Nulo quando ela não diz. */
  tipo: string | null
  status: StatusCampanha
  inicio: string | null
  fim: string | null
  /** Quando o espelho local foi atualizado pela última vez. */
  sincronizadoEm: string | null
  /** O payload cru da plataforma, para o que o modelo canônico não cobre. */
  dadosMarketplace: unknown
}

export type ItemCampanha = {
  campanhaId: string
  anuncioId: string | null
  itemIdExterno: string
  /** Variação. Nulo em anúncio sem variação. */
  modelId: string | null
  /** Preço antes da campanha, informado pela plataforma. */
  precoBase: number | null
  /** Preço dentro da campanha. */
  precoCampanha: number | null
  limitePorCompra: number | null
  estoquePromocao: number | null
}

/** Uma campanha e os itens dela que dizem respeito a um anúncio. */
export type CampanhaDoAnuncio = {
  campanha: CampanhaCanonica
  itens: ItemCampanha[]
}

export type VigenciaCampanha = {
  vigente: boolean
  /** Por que não está vigente, quando não está. */
  motivo: string | null
  /** Avisos que não impedem a vigência mas pedem olhada humana. */
  avisos: string[]
  /** Milissegundos até o fim. Nulo quando não há fim declarado. */
  restaMs: number | null
}

function data(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * A campanha está valendo agora?
 *
 * A JANELA manda, e não o `status`. O status é um retrato do momento em que o
 * espelho foi sincronizado, e a sincronização de campanhas é MANUAL neste
 * sistema (não há cron): uma campanha marcada como "programada" pode já ter
 * começado, e uma marcada como "ativa" pode ter terminado ontem. A janela é
 * fato datado; o status é opinião com data de validade.
 *
 * `encerrada` é a única exceção — é terminal e a plataforma não volta atrás.
 */
export function vigenciaDaCampanha(c: CampanhaCanonica, agora: Date): VigenciaCampanha {
  const avisos: string[] = []
  const inicio = data(c.inicio)
  const fim = data(c.fim)

  if (c.status === 'encerrada') {
    return { vigente: false, motivo: 'a campanha está encerrada na plataforma', avisos, restaMs: null }
  }
  if (c.status === 'rascunho') {
    return { vigente: false, motivo: 'a campanha ainda é rascunho e não foi publicada', avisos, restaMs: null }
  }
  if (inicio && agora < inicio) {
    return { vigente: false, motivo: 'a campanha ainda não começou', avisos, restaMs: null }
  }
  if (fim && agora > fim) {
    return { vigente: false, motivo: 'a janela da campanha já terminou', avisos, restaMs: null }
  }

  // Dentro da janela, mas o espelho diz outra coisa: é sinal de sync atrasado.
  if (c.status === 'programada' && inicio && agora >= inicio) {
    avisos.push('A campanha consta como programada, mas a janela dela já começou — o espelho local está atrasado.')
  }

  return { vigente: true, motivo: null, avisos, restaMs: fim ? fim.getTime() - agora.getTime() : null }
}

export type ProximidadeFim =
  | 'ativa'
  | 'termina_em_7_dias'
  | 'termina_em_3_dias'
  | 'termina_hoje'
  | 'expirada'
  | 'sem_prazo'

/** Limites em dias. Ficam aqui, e não espalhados em componente. */
export const LIMITES_PROXIMIDADE = { atencao: 7, urgente: 3 }

export function proximidadeDoFim(
  restaMs: number | null,
  limites = LIMITES_PROXIMIDADE,
): { estado: ProximidadeFim; diasRestantes: number | null; horasRestantes: number | null } {
  if (restaMs == null) return { estado: 'sem_prazo', diasRestantes: null, horasRestantes: null }
  if (restaMs < 0) return { estado: 'expirada', diasRestantes: 0, horasRestantes: 0 }

  const horas = restaMs / 3_600_000
  const dias = horas / 24
  const diasRestantes = Math.floor(dias)
  const horasRestantes = Math.floor(horas)

  if (horas < 24) return { estado: 'termina_hoje', diasRestantes, horasRestantes }
  if (dias <= limites.urgente) return { estado: 'termina_em_3_dias', diasRestantes, horasRestantes }
  if (dias <= limites.atencao) return { estado: 'termina_em_7_dias', diasRestantes, horasRestantes }
  return { estado: 'ativa', diasRestantes, horasRestantes }
}

/**
 * O item da campanha que vale para este anúncio.
 *
 * Anúncio com variação tem um item por `model_id`, e cada variação pode ter
 * preço diferente. Este módulo trabalha no preço DO ANÚNCIO, então escolher
 * uma variação seria inventar: devolve nulo e avisa, do mesmo jeito que o
 * `aplicar` do recálculo recusa anúncio Shopee com variação.
 */
export function itemDoAnuncio(
  itens: ItemCampanha[],
  anuncioId: string,
): { item: ItemCampanha | null; aviso: string | null } {
  const doAnuncio = itens.filter(i => i.anuncioId === anuncioId && i.precoCampanha != null)
  if (doAnuncio.length === 0) return { item: null, aviso: null }
  if (doAnuncio.length === 1) return { item: doAnuncio[0], aviso: null }

  const precos = new Set(doAnuncio.map(i => i.precoCampanha))
  if (precos.size === 1) return { item: doAnuncio[0], aviso: null }

  return {
    item: null,
    aviso: `A campanha tem ${doAnuncio.length} variações deste anúncio com preços diferentes — o preço do anúncio não é único e não dá para dizer qual vale.`,
  }
}

/**
 * Normaliza uma linha de `marketplace_promocoes` (com os itens embutidos)
 * para o modelo canônico.
 *
 * A plataforma vem do CANAL, não da linha: a tabela não tem coluna de
 * plataforma, e enquanto só a Shopee alimenta ela, derivar é mais honesto que
 * criar coluna para um valor constante.
 */
export function normalizarCampanhaDoEspelho(
  linha: {
    id: string
    empresa_id?: string | null
    canal_id?: string | null
    id_externo?: string | null
    nome?: string | null
    status?: string | null
    inicio?: string | null
    fim?: string | null
    sincronizado_em?: string | null
    dados_brutos?: unknown
    marketplace_promocao_itens?: unknown[]
  },
  canal: { id: string; plataforma: string },
  empresaId: string,
): CampanhaDoAnuncio {
  const statusValidos: StatusCampanha[] = ['rascunho', 'programada', 'ativa', 'encerrada']
  const status = statusValidos.includes(linha.status as StatusCampanha)
    ? (linha.status as StatusCampanha)
    : 'rascunho'

  const campanha: CampanhaCanonica = {
    id: linha.id,
    empresaId: linha.empresa_id ?? empresaId,
    canalId: linha.canal_id ?? canal.id,
    plataforma: canal.plataforma,
    idExterno: linha.id_externo ?? null,
    nome: linha.nome ?? 'Campanha',
    tipo: null,
    status,
    inicio: linha.inicio ?? null,
    fim: linha.fim ?? null,
    sincronizadoEm: linha.sincronizado_em ?? null,
    dadosMarketplace: linha.dados_brutos ?? null,
  }

  const numero = (v: unknown): number | null => {
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const itens: ItemCampanha[] = (linha.marketplace_promocao_itens ?? []).map((bruto) => {
    const i = bruto as Record<string, unknown>
    return {
      campanhaId: linha.id,
      anuncioId: (i.anuncio_id as string | null) ?? null,
      itemIdExterno: String(i.item_id_externo ?? ''),
      modelId: (i.model_id as string | null) ?? null,
      precoBase: numero(i.preco_original),
      precoCampanha: numero(i.preco_promocional),
      limitePorCompra: i.limite_por_compra == null ? null : Number(i.limite_por_compra),
      estoquePromocao: i.estoque_promocao == null ? null : Number(i.estoque_promocao),
    }
  })

  return { campanha, itens }
}
