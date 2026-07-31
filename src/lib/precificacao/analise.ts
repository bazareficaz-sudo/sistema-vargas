import type { ItemRecalculo, ResumoRecalculo } from './recalculo'
import type { Competitividade } from './competitividade'
import { rotuloCompetitividade } from './competitividade'

// Diagnósticos da precificação.
//
// Regra da casa: TODO número aqui sai de conta determinística sobre os dados
// reais. A IA entra depois, e só para redigir — nunca para inventar valor. Se
// a IA falhar ou estiver desligada, os achados continuam corretos, só ficam
// com texto mais seco.

export type Severidade = 'critico' | 'atencao' | 'oportunidade' | 'informativo'

export type Achado = {
  id: string
  severidade: Severidade
  titulo: string
  detalhe: string
  quantidade?: number
  valor?: number
  acao?: string
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const n = (v: number) => v.toLocaleString('pt-BR')

export function diagnosticar(params: {
  resumo: ResumoRecalculo
  itens: ItemRecalculo[]
  margemAlvoBaixa?: number
}): Achado[] {
  const { resumo, itens } = params
  const margemBaixa = params.margemAlvoBaixa ?? 8
  const achados: Achado[] = []

  // ── O que está sangrando agora ──
  if (resumo.emPrejuizoAgora > 0) {
    achados.push({
      id: 'prejuizo',
      severidade: 'critico',
      titulo: `${n(resumo.emPrejuizoAgora)} anúncio(s) vendendo com prejuízo`,
      detalhe: 'Nesses casos, o preço no ar não cobre o custo mais as taxas do canal. Cada venda tira dinheiro do caixa.',
      quantidade: resumo.emPrejuizoAgora,
      acao: 'Recalcular em massa e aplicar o novo preço',
    })
  }

  const margemRuim = itens.filter(i => i.margemAtual >= 0 && i.margemAtual < margemBaixa)
  if (margemRuim.length > 0) {
    achados.push({
      id: 'margem_baixa',
      severidade: 'atencao',
      titulo: `${n(margemRuim.length)} anúncio(s) com margem abaixo de ${margemBaixa}%`,
      detalhe: `Margem apertada não deixa espaço para devolução, avaria ou aumento de custo. O menor está em ${margemRuim.reduce((m, i) => Math.min(m, i.margemAtual), 999).toFixed(1)}%.`,
      quantidade: margemRuim.length,
      acao: 'Revisar a regra desses produtos ou renegociar o custo',
    })
  }

  // ── Dinheiro que a regra recuperaria ──
  const subindo = itens.filter(i => i.diferenca > 0)
  if (subindo.length > 0) {
    const soma = subindo.reduce((s, i) => s + i.diferenca, 0)
    achados.push({
      id: 'abaixo_da_regra',
      severidade: 'oportunidade',
      titulo: `${n(subindo.length)} anúncio(s) estão mais baratos do que a sua regra manda`,
      detalhe: `Somando a diferença de todos, são ${brl(soma)} a mais por unidade vendida — o que cada venda deixa de render hoje.`,
      quantidade: subindo.length,
      valor: soma,
      acao: 'Recalcular em massa',
    })
  }

  const descendo = itens.filter(i => i.diferenca < 0)
  if (descendo.length > 0) {
    achados.push({
      id: 'acima_da_regra',
      severidade: 'oportunidade',
      titulo: `${n(descendo.length)} anúncio(s) podem baixar de preço mantendo a margem`,
      detalhe: 'A regra permite um preço menor do que o que está no ar. Baixar aumenta a chance de venda sem comer a margem que você definiu.',
      quantidade: descendo.length,
      acao: 'Recalcular em massa',
    })
  }

  // ── Regra ou taxa mal configurada ──
  if (resumo.emPrejuizoDepois > 0) {
    achados.push({
      id: 'prejuizo_persistente',
      severidade: 'critico',
      titulo: `${n(resumo.emPrejuizoDepois)} anúncio(s) continuariam em prejuízo mesmo depois do recálculo`,
      detalhe: 'Isso não é preço desatualizado: é a regra ou as taxas desses casos que estão erradas. Recalcular não resolve.',
      quantidade: resumo.emPrejuizoDepois,
      acao: 'Revisar a regra aplicada e as taxas do canal',
    })
  }

  const comPiso = itens.filter(i => i.avisos.some(a => a.includes('mínimo')))
  if (comPiso.length > 0) {
    achados.push({
      id: 'piso_acionado',
      severidade: 'atencao',
      titulo: `${n(comPiso.length)} anúncio(s) só fecham conta por causa da margem mínima`,
      detalhe: 'O objetivo da regra sozinho daria margem menor que o piso configurado. Vale conferir se o objetivo dessa regra ainda faz sentido.',
      quantidade: comPiso.length,
    })
  }

  // ── Buracos de cadastro que limitam o módulo inteiro ──
  if (resumo.semProduto > 0) {
    achados.push({
      id: 'sem_produto',
      severidade: 'atencao',
      titulo: `${n(resumo.semProduto)} anúncio(s) sem produto vinculado`,
      detalhe: 'Sem produto não há custo, e sem custo nada aqui consegue calcular margem. É o que mais limita o alcance da precificação hoje.',
      quantidade: resumo.semProduto,
      acao: 'Mapa de Anúncios → Revisar sugestões',
    })
  }
  if (resumo.semCusto > 0) {
    achados.push({
      id: 'sem_custo',
      severidade: 'atencao',
      titulo: `${n(resumo.semCusto)} anúncio(s) com produto sem custo cadastrado`,
      detalhe: 'O produto está vinculado, mas não tem preço de custo — a margem fica impossível de calcular.',
      quantidade: resumo.semCusto,
      acao: 'Preencher o custo no cadastro do produto',
    })
  }
  if (resumo.semRegra > 0) {
    achados.push({
      id: 'sem_regra',
      severidade: 'informativo',
      titulo: `${n(resumo.semRegra)} anúncio(s) sem nenhuma regra aplicável`,
      detalhe: 'Uma regra geral da empresa cobre todos esses de uma vez.',
      quantidade: resumo.semRegra,
      acao: 'Criar uma regra geral',
    })
  }

  const ordem: Record<Severidade, number> = { critico: 0, atencao: 1, oportunidade: 2, informativo: 3 }
  return achados.sort((a, b) => ordem[a.severidade] - ordem[b.severidade])
}

// ── Competitividade ──────────────────────────────────────────

export type AchadoCompetitivo = {
  anuncioId: string
  titulo: string
  canalNome: string
  precoAtual: number
  precoSugerido: number
  statusRotulo: string
  // Até onde dá pra baixar sem furar a margem mínima da regra — este é o
  // número que transforma "estamos caros" em decisão.
  precoMinimoViavel: number | null
  sugestaoCabe: boolean
  margemNoSugerido: number | null
}

export function cruzarCompetitividade(
  comp: Competitividade,
  contexto: { anuncioId: string; titulo: string; canalNome: string; margemNoSugerido: number | null; precoMinimoViavel: number | null },
): AchadoCompetitivo | null {
  if (!comp.temBenchmark || comp.precoSugerido == null || comp.precoAtual == null) return null
  return {
    anuncioId: contexto.anuncioId,
    titulo: contexto.titulo,
    canalNome: contexto.canalNome,
    precoAtual: comp.precoAtual,
    precoSugerido: comp.precoSugerido,
    statusRotulo: rotuloCompetitividade(comp.status),
    precoMinimoViavel: contexto.precoMinimoViavel,
    sugestaoCabe: contexto.precoMinimoViavel != null ? comp.precoSugerido >= contexto.precoMinimoViavel : false,
    margemNoSugerido: contexto.margemNoSugerido,
  }
}
