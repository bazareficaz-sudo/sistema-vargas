import { estaBloqueado } from './margens'
import type { EstrategiaEconomicaAnuncio } from './estrategia'
import type { SinalEstoque, SinalVendas } from './sinais'
import type { Capacidade } from './capacidades'

// RECOMENDAÇÕES COMERCIAIS DETERMINÍSTICAS — camada PURA.
//
// Sem IA, sem LLM, sem tabela. Toda recomendação sai de comparação entre
// números que o motor já apurou e sinais que já existem no banco.
//
// TRÊS COISAS DIFERENTES, e o código separa as três:
//
//   DIAGNÓSTICO   o que os números dizem      "margem alta, estoque parado"
//   RECOMENDAÇÃO  o que vale considerar       "avaliar promoção"
//   AÇÃO          o que o usuário pode fazer  "simular desconto"
//
// Nada aqui executa nada. A ação é sempre uma sugestão de próximo passo para
// uma pessoa, nunca um comando.
//
// O GUARDRAIL VENCE SEMPRE. Nenhuma combinação de estoque parado, campanha
// terminando ou boa margem pode produzir uma recomendação de descer preço
// quando o item já está abaixo do piso. Isso não é uma regra entre outras: é
// a precedência, aplicada em `resolverConflitos`.

export type Prioridade = 'critica' | 'alta' | 'media' | 'baixa' | 'informativa'

export const ORDEM_PRIORIDADE: Record<Prioridade, number> = {
  critica: 0, alta: 1, media: 2, baixa: 3, informativa: 4,
}

export type TipoRecomendacao =
  // Guardrails — sempre críticos
  | 'abaixo_do_piso'
  | 'sem_custo'
  | 'sem_regra'
  // Atenção
  | 'promocao_terminando'
  | 'fora_da_politica_promocional'
  | 'preco_efetivo_inconsistente'
  | 'dados_de_campanha_desatualizados'
  | 'campanhas_nao_lidas_no_canal'
  | 'sem_estoque'
  // Oportunidades
  | 'espaco_para_promocao'
  | 'atacado_possivel'
  | 'margem_alta_estoque_parado'
  // Informativas
  | 'margem_no_alvo'
  | 'sem_espaco_para_promocao'
  | 'sem_politica_promocional'
  | 'estoque_curto_evitar_desconto'

export type Evidencia = { rotulo: string; valor: string }

export type Recomendacao = {
  tipo: TipoRecomendacao
  prioridade: Prioridade
  /** O que os números dizem. */
  diagnostico: string
  /** O que vale considerar. */
  recomendacao: string
  /** O próximo passo que uma PESSOA pode dar. Nunca é executado sozinho. */
  acaoSugerida: string | null
  /** Os números que sustentam a recomendação — nunca caixa-preta. */
  evidencias: Evidencia[]
  /** Preço que a recomendação aponta, quando aponta para um. */
  preco?: number
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const pct = (v: number) => `${v.toFixed(1).replace('.', ',')}%`

export type EntradaRecomendacoes = {
  estrategia: EstrategiaEconomicaAnuncio
  estoque: SinalEstoque
  vendas: SinalVendas
  /** Cabe atacado nesta economia? Vem de `quantidade.ts`. */
  atacado?: { cabe: boolean; motivo: string; economiaPorUnidade: number } | null
  /** Capacidade do canal para publicar preço por quantidade. */
  capacidadeAtacado?: Capacidade | null
  /**
   * Capacidade do canal para LER campanhas.
   *
   * Sem ela, "sincronize as promoções" é um conselho impossível: a Shopee
   * tem rota de sincronização, o Mercado Livre não tem nenhuma.
   */
  capacidadeCampanhas?: Capacidade | null
  /** Quando o espelho de campanhas foi sincronizado pela última vez. */
  campanhaSincronizadaEm?: string | null
  agora?: Date
}

const DIAS_ESPELHO_VELHO = 3

/**
 * Todas as recomendações que se aplicam, já sem contradição e ordenadas.
 *
 * A ordem é por prioridade, e dentro dela pela ordem de geração — que vai do
 * guardrail para a oportunidade.
 */
export function recomendar(entrada: EntradaRecomendacoes): Recomendacao[] {
  const brutas = gerar(entrada)
  return resolverConflitos(brutas)
    .sort((a, b) => ORDEM_PRIORIDADE[a.prioridade] - ORDEM_PRIORIDADE[b.prioridade])
}

function gerar(entrada: EntradaRecomendacoes): Recomendacao[] {
  const { estrategia: e, estoque, vendas } = entrada
  const saida: Recomendacao[] = []
  const m = e.margens

  const evidenciasBase = (): Evidencia[] => {
    const ev: Evidencia[] = [
      { rotulo: 'Preço efetivo', valor: brl(e.precoEfetivo) },
      { rotulo: 'Margem efetiva', valor: pct(e.margemEfetiva) },
      { rotulo: 'Margem alvo', valor: pct(m.alvo) },
    ]
    if (m.promocionalMinima != null) ev.push({ rotulo: 'Mínimo promocional', valor: pct(m.promocionalMinima) })
    if (m.piso != null) ev.push({ rotulo: 'Piso', valor: pct(m.piso) })
    if (estoque.disponivel != null) ev.push({ rotulo: 'Estoque disponível', valor: String(estoque.disponivel) })
    if (vendas.unidades != null) ev.push({ rotulo: `Vendas ${vendas.dias} dias`, valor: `${vendas.unidades} un` })
    if (vendas.coberturaDias != null && vendas.confiavel) {
      ev.push({ rotulo: 'Cobertura', valor: `${vendas.coberturaDias} dias` })
    }
    return ev
  }

  // ── Guardrails ────────────────────────────────────────────────────────────
  if (estaBloqueado(e.classificacao.classificacao)) {
    saida.push({
      tipo: 'abaixo_do_piso', prioridade: 'critica',
      diagnostico: e.classificacao.motivo,
      recomendacao: 'Subir o preço até o piso, ou revisar custo e taxas do canal.',
      acaoSugerida: e.precoPiso != null ? `Simular o preço de ${brl(e.precoPiso)}` : 'Revisar a regra e as taxas do canal',
      evidencias: evidenciasBase(),
      preco: e.precoPiso ?? undefined,
    })
  }

  if (!e.regraAplicada) {
    saida.push({
      tipo: 'sem_regra', prioridade: 'critica',
      diagnostico: 'Nenhuma regra de precificação se aplica a este anúncio neste canal.',
      recomendacao: 'Sem regra não há margem alvo, e sem alvo não há política a cumprir.',
      acaoSugerida: 'Criar ao menos uma regra geral da empresa',
      evidencias: evidenciasBase(),
    })
  }

  if (!estoque.temEstoque) {
    saida.push({
      tipo: 'sem_estoque', prioridade: 'alta',
      diagnostico: estoque.disponivel == null
        ? 'Não foi possível apurar o estoque disponível deste anúncio.'
        : 'Sem estoque disponível.',
      recomendacao: 'Nenhuma estratégia de preço muda um item que não pode ser entregue.',
      acaoSugerida: 'Repor antes de mexer em preço',
      evidencias: evidenciasBase(),
    })
  }

  // ── Atenção ───────────────────────────────────────────────────────────────
  if (e.flags.includes('promocao_terminando') && e.campanha) {
    const dias = e.campanha.diasRestantes
    saida.push({
      tipo: 'promocao_terminando', prioridade: 'alta',
      diagnostico: `A campanha "${e.campanha.nome}" termina ${dias === 0 ? 'hoje' : `em ${dias} dia(s)`}.`,
      recomendacao: `Quando ela sair, o preço volta para ${brl(e.precoBase)}.`,
      acaoSugerida: 'Decidir se renova, substitui ou deixa terminar',
      evidencias: [
        ...evidenciasBase(),
        { rotulo: 'Campanha', valor: e.campanha.nome },
        { rotulo: 'Termina em', valor: dias != null ? `${dias} dia(s)` : 'sem prazo declarado' },
        { rotulo: 'Preço quando sair', valor: brl(e.precoBase) },
      ],
      preco: e.precoBase,
    })
  }

  if (e.classificacao.classificacao === 'requer_aprovacao') {
    saida.push({
      tipo: 'fora_da_politica_promocional', prioridade: 'alta',
      diagnostico: e.classificacao.motivo,
      recomendacao: 'Está economicamente possível, mas fora da política — precisa de decisão de gente.',
      acaoSugerida: e.precoPromocionalLimite != null
        ? `Subir para ${brl(e.precoPromocionalLimite)} volta à política`
        : 'Declarar a margem promocional mínima na regra',
      evidencias: evidenciasBase(),
      preco: e.precoPromocionalLimite ?? undefined,
    })
  }

  if (e.flags.includes('preco_efetivo_inconsistente')) {
    saida.push({
      tipo: 'preco_efetivo_inconsistente', prioridade: 'alta',
      diagnostico: e.avisos.join(' '),
      recomendacao: 'Alguma sincronização está atrasada — o preço mostrado pode não ser o que está no ar.',
      acaoSugerida: 'Sincronizar anúncios e campanhas antes de decidir',
      evidencias: evidenciasBase(),
    })
  }

  // Campanhas do canal: o conselho depende de o sistema saber LER campanhas
  // daquela plataforma. Sugerir "sincronize" a um canal sem rota de
  // sincronização manda o operador procurar um botão que não existe — e,
  // pior, sugere que o problema é de atualização quando é de cobertura.
  const leCampanhas = entrada.capacidadeCampanhas?.estado
  if (leCampanhas != null && leCampanhas !== 'suportado') {
    saida.push({
      tipo: 'campanhas_nao_lidas_no_canal', prioridade: 'media',
      diagnostico: 'O sistema não lê as campanhas deste canal — nunca leu.',
      recomendacao:
        'Se houver promoção no ar na plataforma, ela não entra nesta conta, e a margem mostrada aqui pode não ser a que está valendo.',
      acaoSugerida: 'Conferir no painel da plataforma antes de mudar preço',
      evidencias: [
        ...evidenciasBase(),
        { rotulo: 'Leitura de campanhas', valor: entrada.capacidadeCampanhas?.motivo ?? 'não disponível' },
      ],
    })
  } else {
    const espelhoVelho = espelhoDesatualizado(entrada)
    if (espelhoVelho) {
      saida.push({
        tipo: 'dados_de_campanha_desatualizados', prioridade: 'media',
        diagnostico: espelhoVelho,
        recomendacao: 'Campanha que começou depois da última sincronização não aparece aqui.',
        acaoSugerida: 'Sincronizar promoções do canal',
        evidencias: evidenciasBase(),
      })
    }
  }

  // ── Oportunidades ─────────────────────────────────────────────────────────
  const temFolga = e.precoPromocionalLimite != null && e.precoEfetivo > e.precoPromocionalLimite + 0.01

  if (e.estado === 'normal' && temFolga) {
    const desconto = ((e.precoEfetivo - e.precoPromocionalLimite!) / e.precoEfetivo) * 100
    const parado = vendas.confiavel && vendas.nivel === 'longa'
    saida.push({
      tipo: parado ? 'margem_alta_estoque_parado' : 'espaco_para_promocao',
      prioridade: parado ? 'media' : 'baixa',
      diagnostico: parado
        ? `Margem de ${pct(e.margemEfetiva)} com ${vendas.coberturaDias} dias de cobertura — mercadoria parada com folga de preço.`
        : `Margem de ${pct(e.margemEfetiva)}, acima do mínimo promocional.`,
      recomendacao: `Dá para descer até ${brl(e.precoPromocionalLimite!)} (${pct(desconto)}) sem sair da política.`,
      acaoSugerida: 'Simular a promoção antes de decidir',
      evidencias: evidenciasBase(),
      preco: e.precoPromocionalLimite!,
    })
  }

  if (entrada.atacado?.cabe && estoque.temEstoque) {
    const cap = entrada.capacidadeAtacado
    const publicavel = cap?.estado === 'suportado'
    saida.push({
      tipo: 'atacado_possivel', prioridade: 'media',
      diagnostico: entrada.atacado.motivo,
      recomendacao: publicavel
        ? 'Faixas por quantidade cabem economicamente e o canal aceita publicá-las.'
        : 'Faixas por quantidade cabem economicamente. A publicação no canal ainda não está disponível.',
      acaoSugerida: 'Simular as faixas de quantidade',
      evidencias: [
        ...evidenciasBase(),
        ...(entrada.atacado.economiaPorUnidade > 0
          ? [{ rotulo: 'Economia por diluição do frete', valor: brl(entrada.atacado.economiaPorUnidade) }]
          : []),
        { rotulo: 'Publicação no canal', valor: cap?.estado ?? 'não verificada' },
      ],
    })
  }

  // ── Informativas ──────────────────────────────────────────────────────────
  if (e.classificacao.classificacao === 'alvo' && !temFolga) {
    saida.push({
      tipo: 'margem_no_alvo', prioridade: 'informativa',
      diagnostico: e.classificacao.motivo,
      recomendacao: 'Nada a fazer.',
      acaoSugerida: null,
      evidencias: evidenciasBase(),
    })
  }

  if (e.flags.includes('sem_politica_promocional')) {
    saida.push({
      tipo: 'sem_politica_promocional', prioridade: 'baixa',
      diagnostico: 'A regra deste anúncio não declara margem promocional mínima.',
      recomendacao: 'Sem ela, nenhum desconto é aprovado sozinho e tudo abaixo da meta cai em "requer aprovação".',
      acaoSugerida: 'Declarar a margem promocional mínima na regra',
      evidencias: evidenciasBase(),
    })
  }

  if (e.estado === 'normal' && e.precoPromocionalLimite != null && !temFolga) {
    saida.push({
      tipo: 'sem_espaco_para_promocao', prioridade: 'informativa',
      diagnostico: `O preço de hoje já está no limite da política (${brl(e.precoPromocionalLimite)}).`,
      recomendacao: 'Promover exigiria aprovação.',
      acaoSugerida: null,
      evidencias: evidenciasBase(),
    })
  }

  if (vendas.confiavel && vendas.nivel === 'curta' && estoque.temEstoque) {
    saida.push({
      tipo: 'estoque_curto_evitar_desconto', prioridade: 'media',
      diagnostico: vendas.motivo,
      recomendacao: 'Com estoque curto e saída boa, desconto troca margem por nada — o item já vende.',
      acaoSugerida: 'Repor antes de promover',
      evidencias: evidenciasBase(),
    })
  }

  return saida
}

function espelhoDesatualizado(entrada: EntradaRecomendacoes): string | null {
  const quando = entrada.campanhaSincronizadaEm
  if (!quando) {
    return 'As campanhas deste canal nunca foram sincronizadas — o sistema não sabe se existe alguma no ar.'
  }
  const d = new Date(quando)
  if (Number.isNaN(d.getTime())) return null
  const dias = ((entrada.agora ?? new Date()).getTime() - d.getTime()) / 86_400_000
  if (dias < DIAS_ESPELHO_VELHO) return null
  return `As campanhas deste canal foram sincronizadas há ${Math.floor(dias)} dias.`
}

/**
 * Remove contradições. O guardrail econômico sempre vence.
 *
 * As regras, em ordem:
 *
 *   1. Abaixo do piso elimina toda recomendação de descer preço. Um item que
 *      já está proibido não ganha sugestão de ficar mais barato.
 *   2. Sem estoque elimina oportunidade comercial: não se promove o que não
 *      se pode entregar.
 *   3. Sem custo ou sem regra elimina qualquer sugestão de preço — a conta que
 *      a sustentaria não existe.
 *   4. Estoque curto rebaixa a prioridade de promover, sem apagá-la: pode ser
 *      uma decisão consciente, mas não deve aparecer como oportunidade.
 */
export function resolverConflitos(rs: Recomendacao[]): Recomendacao[] {
  const bloqueado = rs.some(r => r.tipo === 'abaixo_do_piso')
  const semEstoque = rs.some(r => r.tipo === 'sem_estoque')
  const semBase = rs.some(r => r.tipo === 'sem_regra' || r.tipo === 'sem_custo')
  const estoqueCurto = rs.some(r => r.tipo === 'estoque_curto_evitar_desconto')

  const DESCEM_PRECO: TipoRecomendacao[] = [
    'espaco_para_promocao', 'atacado_possivel', 'margem_alta_estoque_parado',
  ]

  return rs
    .filter(r => {
      if ((bloqueado || semBase) && DESCEM_PRECO.includes(r.tipo)) return false
      if (semEstoque && (DESCEM_PRECO.includes(r.tipo) || r.tipo === 'sem_espaco_para_promocao')) return false
      return true
    })
    .map(r => {
      if (estoqueCurto && DESCEM_PRECO.includes(r.tipo)) {
        return {
          ...r,
          prioridade: 'baixa' as Prioridade,
          recomendacao: `${r.recomendacao} Atenção: o estoque cobre poucos dias no ritmo atual.`,
        }
      }
      return r
    })
}

export const ROTULO_PRIORIDADE: Record<Prioridade, { texto: string; cor: string }> = {
  critica: { texto: 'Crítica', cor: 'text-red-700 bg-red-50 border-red-200' },
  alta: { texto: 'Alta', cor: 'text-amber-700 bg-amber-50 border-amber-200' },
  media: { texto: 'Média', cor: 'text-blue-700 bg-blue-50 border-blue-200' },
  baixa: { texto: 'Baixa', cor: 'text-slate-600 bg-slate-50 border-slate-200' },
  informativa: { texto: 'Informativa', cor: 'text-gray-500 bg-gray-50 border-gray-200' },
}
