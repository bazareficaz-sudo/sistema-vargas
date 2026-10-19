// A TAXA QUE VALE: qual forma, quantas parcelas, em que dia.
//
// Espelha `taxa_vigente_v1` no banco. As duas existem de propósito: o banco
// precisa da função para projetar as colunas antigas de `saude_config` num
// trigger, e o web precisa dela para calcular margem sem uma ida ao servidor
// por item do carrinho. Divergir aqui faria a margem na tela discordar do
// lançamento no caixa — e a conferência acusaria erro da adquirente que é
// nosso.
//
// ── DUAS ESCADAS, E NENHUM VÃO ───────────────────────────────────────────
//
// A primeira escada é a VIGÊNCIA: vale a mais recente que já começou. Não
// existe `vigente_ate`, porque data de fim cria dia sem taxa — bastaria
// terminar uma véspera antes de a seguinte começar.
//
// A segunda é a PARCELA: `parcelas_min` é o degrau, e vale daqui para cima
// até o próximo. Não existe `parcelas_max` pelo mesmo motivo.
//
// Esse vão já custou caro neste sistema: as faixas de saúde tinham
// `margem_min` e `margem_max`, e com os números reais da loja (70/50/30/5)
// uma margem de 69,5% não caía em faixa nenhuma e era classificada como
// Prejuízo — que BLOQUEIA a venda. Ver `encontrarFaixa` em lib/saude-venda.

export type TaxaDegrau = {
  parcelas_min: number
  taxa_pct: number
  /** Dias até o dinheiro cair. `null` é "não informado", diferente de zero. */
  prazo_dias: number | null
  /** ISO `YYYY-MM-DD`. */
  vigente_de: string
}

export type LiquidacaoForma = 'imediata' | 'adquirente' | 'fiado'

export type FormaPagamento = {
  id: string
  codigo: string
  nome: string
  icone: string | null
  tecla: string | null
  ordem: number
  ativo: boolean
  liquidacao: LiquidacaoForma
  caixa_destino_id: string | null
  adquirente_caixa_id: string | null
  aceita_parcelamento: boolean
  parcelas_max: number
}

export type FormaComTaxas = FormaPagamento & { taxas: TaxaDegrau[] }

/** A vigência que vale num dia: a mais recente que já começou. */
export function vigenciaDe(degraus: TaxaDegrau[], data: string): string | null {
  if (degraus.length === 0) return null
  const comecadas = degraus.filter(d => d.vigente_de <= data).map(d => d.vigente_de)
  if (comecadas.length > 0) return comecadas.reduce((a, b) => (a > b ? a : b))
  // Pergunta sobre data anterior ao primeiro cadastro. Devolver nada daria
  // taxa zero, e taxa zero infla a margem exatamente onde ela importa — num
  // relançamento de venda antiga. Vale a mais antiga, e fica explícito.
  return degraus.map(d => d.vigente_de).reduce((a, b) => (a < b ? a : b))
}

/**
 * O degrau que vale, ou `null` quando a forma não tem degrau que sirva.
 *
 * `null` acontece quando nenhum degrau da vigência tem `parcelas_min` menor ou
 * igual ao pedido — ou seja, quando falta o degrau de 1x. É devolvido em vez
 * de adivinhado: a tela de cadastro é que exige o degrau de 1x, porque é lá
 * que dá para dizer qual é o valor certo. Chutar aqui gravaria taxa errada no
 * caixa sem ninguém ver.
 */
export function degrauVigente(
  degraus: TaxaDegrau[],
  parcelas = 1,
  data: string = hojeISO(),
): TaxaDegrau | null {
  const vigencia = vigenciaDe(degraus, data)
  if (!vigencia) return null
  const n = Math.max(1, Math.floor(parcelas) || 1)
  const candidatos = degraus
    .filter(d => d.vigente_de === vigencia && d.parcelas_min <= n)
    .sort((a, b) => b.parcelas_min - a.parcelas_min)
  return candidatos[0] ?? null
}

/** A taxa em porcentagem, ou `null` quando não há degrau que sirva. */
export function taxaDe(degraus: TaxaDegrau[], parcelas = 1, data: string = hojeISO()): number | null {
  const d = degrauVigente(degraus, parcelas, data)
  return d ? d.taxa_pct : null
}

/** O prazo em dias, ou `null` quando não informado (ou sem degrau). */
export function prazoDe(degraus: TaxaDegrau[], parcelas = 1, data: string = hojeISO()): number | null {
  const d = degrauVigente(degraus, parcelas, data)
  return d ? d.prazo_dias : null
}

/**
 * Em que dia o dinheiro desta venda cai.
 *
 * `null` quando o prazo não foi informado — e aí a resposta honesta é "não
 * sei", não a data de hoje. Conciliação que supõe D+0 acusa atraso em toda
 * venda no crédito.
 */
export function previsaoDeCredito(
  degraus: TaxaDegrau[],
  dataVenda: string,
  parcelas = 1,
): string | null {
  const prazo = prazoDe(degraus, parcelas, dataVenda)
  if (prazo === null) return null
  const d = new Date(`${dataVenda}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + prazo)
  return d.toISOString().slice(0, 10)
}

/**
 * O que falta para esta forma poder lançar no caixa.
 *
 * A lista é o que a tela de cadastro cobra antes de deixar salvar. Hoje, sem
 * nada disso, a venda não chega ao ledger: 2.123 vendas em 60 dias e 13
 * movimentos lançados.
 */
export function pendenciasDaForma(forma: FormaComTaxas, data: string = hojeISO()): string[] {
  const faltas: string[] = []

  if (degrauVigente(forma.taxas, 1, data) === null) {
    faltas.push('sem taxa cadastrada para 1x')
  }

  if (forma.liquidacao === 'adquirente' && !forma.adquirente_caixa_id) {
    faltas.push('não diz em qual adquirente passa')
  }

  // Prazo só é exigido de quem não cai na hora. Dinheiro na gaveta e pix
  // instantâneo têm prazo zero, que é informação, não ausência dela.
  if (forma.liquidacao === 'adquirente') {
    const ate = forma.aceita_parcelamento ? Math.max(1, forma.parcelas_max) : 1
    for (let n = 1; n <= ate; n++) {
      if (prazoDe(forma.taxas, n, data) === null) {
        faltas.push(ate > 1 ? `sem prazo de recebimento em ${n}x` : 'sem prazo de recebimento')
      }
    }
  }

  return faltas
}

/** Hoje em `YYYY-MM-DD`, no fuso de São Paulo. */
export function hojeISO(): string {
  // `sv-SE` devolve exatamente `YYYY-MM-DD`. O fuso é fixo porque venda do
  // balcão às 21h de São Paulo é do dia 18, não do dia 19 em UTC — e a
  // vigência da taxa é comparada por data, não por instante.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}
