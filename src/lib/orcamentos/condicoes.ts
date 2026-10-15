// Condições comerciais do orçamento e o texto que o cliente recebe.
//
// O mesmo texto serve para o WhatsApp e para a impressão — se fossem dois
// lugares diferentes, um sairia desatualizado do outro e o cliente receberia
// uma condição na conversa e outra no papel.

export type CondicoesOrcamento = {
  descontoAvistaPct: number
  avistaFormas: string[]
  parcelasMax: number | null
  parcelasSemJuros: boolean
  observacao: string | null
}

export const FORMA_AVISTA_LABEL: Record<string, string> = {
  pix: 'Pix',
  dinheiro: 'dinheiro',
  debito: 'cartão de débito',
  transferencia: 'transferência',
}

const brl = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function totalAvista(total: number, c: CondicoesOrcamento): number {
  if (!(c.descontoAvistaPct > 0)) return total
  return Math.round(total * (1 - c.descontoAvistaPct / 100) * 100) / 100
}

export function temCondicoes(c: CondicoesOrcamento): boolean {
  return c.descontoAvistaPct > 0 || (c.parcelasMax ?? 0) > 1 || !!c.observacao?.trim()
}

// ── Parcelamento sugerido ───────────────────────────────────
//
// A regra é a PARCELA, não o número de vezes: `floor(total / mínima)`.
//
//     R$  80 → 1x   (não alcança a mínima: some sozinho)
//     R$ 100 → 2x de R$ 50,00
//     R$ 150 → 3x de R$ 50,00
//
// Um "sempre 3x" ofereceria 3x de R$ 26,67 num orçamento de R$ 80 — parcela
// que não paga o custo de processar.
//
// DOIS TETOS, e vence o MENOR:
//
//   `teto`        o da configuração da empresa
//   `tetoFaixa`   o da faixa de saúde DESTE orçamento
//
// O da faixa manda porque parcelar custa dinheiro de verdade: a taxa de
// crédito é `vista + (n-1) × parcelado`, então 3x sai por 8% da venda com as
// taxas do Bazar Eficaz. Margem apertada não sustenta isso, e é por isso que
// a faixa "Atenção" já vem com `permite_parcelamento: false`.
//
// Devolve 1 quando não há parcelamento a oferecer — e 1 não é "1x no cartão",
// é "só à vista". Quem exibe decide se mostra a linha.
export function parcelasSugeridas(
  total: number,
  { parcelaMinima, teto, tetoFaixa }:
    { parcelaMinima: number; teto: number; tetoFaixa?: number | null },
): number {
  const t = Number(total ?? 0)
  const minima = Number(parcelaMinima ?? 0)
  if (!(t > 0) || !(minima > 0)) return 1
  const limites = [Math.floor(t / minima), Math.floor(Number(teto ?? 1))]
  if (tetoFaixa != null) limites.push(Math.floor(Number(tetoFaixa)))
  return Math.max(1, Math.min(...limites.filter(n => Number.isFinite(n))))
}

/** Lista das condições em frases curtas — usada na tela, no papel e no zap. */
export function linhasCondicoes(total: number, c: CondicoesOrcamento): string[] {
  const linhas: string[] = []

  if (c.descontoAvistaPct > 0) {
    const formas = c.avistaFormas.length > 0
      ? c.avistaFormas.map(f => FORMA_AVISTA_LABEL[f] ?? f).join(' ou ')
      : 'à vista'
    const economia = total - totalAvista(total, c)
    linhas.push(
      `À vista em ${formas}: ${brl(totalAvista(total, c))}`
      + ` (${c.descontoAvistaPct}% de desconto — você economiza ${brl(economia)})`)
  }

  if ((c.parcelasMax ?? 0) > 1) {
    const n = c.parcelasMax!
    const parcela = Math.round((total / n) * 100) / 100
    linhas.push(`Ou em até ${n}x de ${brl(parcela)}${c.parcelasSemJuros ? ' sem juros' : ''}`)
  }

  if (c.observacao?.trim()) linhas.push(c.observacao.trim())
  return linhas
}

// ── Promoção virando desconto à vista ───────────────────────
//
// Estratégia ligada em Saúde da venda: o item em promoção sai no orçamento
// pelo preço cheio, e a promoção reaparece como desconto à vista.
//
// Com vários itens, o percentual é a média PONDERADA — quanto a soma
// promocional representa de desconto sobre a soma cheia. Média simples dos
// percentuais mentiria: 10% num item de R$ 1.000 e 50% num de R$ 10 não é
// um desconto de 30%.

export type ItemComPromo = {
  quantidade: number
  precoCheio: number     // produtos.preco_venda
  precoPraticado: number // o que está no orçamento (promocional, se houver)
}

export type VitrinePromo = {
  totalCheio: number
  totalPraticado: number
  descontoPct: number
  temPromo: boolean
}

export function calcularVitrinePromo(itens: ItemComPromo[]): VitrinePromo {
  let totalCheio = 0
  let totalPraticado = 0
  for (const i of itens) {
    const q = Number(i.quantidade ?? 0)
    // Preço cheio menor que o praticado não é promoção — é preço de tabela
    // desatualizado ou negociação para cima. Nesse caso o cheio vira o
    // praticado, senão apareceria um "desconto negativo" na tela.
    const cheio = Math.max(Number(i.precoCheio ?? 0), Number(i.precoPraticado ?? 0))
    totalCheio += cheio * q
    totalPraticado += Number(i.precoPraticado ?? 0) * q
  }
  const bruto = totalCheio > 0 ? (1 - totalPraticado / totalCheio) * 100 : 0
  return {
    totalCheio: Math.round(totalCheio * 100) / 100,
    totalPraticado: Math.round(totalPraticado * 100) / 100,
    // Duas casas: com centavos, arredondar para inteiro faria o valor à
    // vista não bater com o total praticado.
    descontoPct: Math.round(bruto * 100) / 100,
    temPromo: bruto > 0.005,
  }
}

export type DadosMensagem = {
  numero: number | string
  empresaNome?: string | null
  clienteNome?: string | null
  itens: { produto_nome: string; quantidade: number; preco_unitario: number; total: number }[]
  total: number
  validade?: string | null
  condicoes: CondicoesOrcamento
}

/**
 * Mensagem pronta para o WhatsApp. Texto puro com asteriscos — é o que o
 * WhatsApp entende como negrito, e é onde o olho do cliente para primeiro.
 */
export function montarMensagemOrcamento(d: DadosMensagem): string {
  const partes: string[] = []

  partes.push(`*Orçamento #${d.numero}*${d.empresaNome ? ` — ${d.empresaNome}` : ''}`)
  if (d.clienteNome) partes.push(`Para: ${d.clienteNome}`)
  partes.push('')

  // Lista de itens. Acima de 20 itens vira uma parede de texto no celular,
  // então resume o restante em vez de despejar tudo.
  const LIMITE = 20
  for (const i of d.itens.slice(0, LIMITE)) {
    partes.push(`• ${i.quantidade}x ${i.produto_nome} — ${brl(i.total)}`)
  }
  if (d.itens.length > LIMITE) {
    partes.push(`• ...e mais ${d.itens.length - LIMITE} item(ns)`)
  }

  partes.push('')
  partes.push(`*Total: ${brl(d.total)}*`)

  const cond = linhasCondicoes(d.total, d.condicoes)
  if (cond.length > 0) {
    partes.push('')
    partes.push('*Condições de pagamento*')
    for (const l of cond) partes.push(`✅ ${l}`)
  }

  if (d.validade) {
    partes.push('')
    partes.push(`Válido até ${new Date(d.validade + 'T00:00:00').toLocaleDateString('pt-BR')}.`)
  }

  return partes.join('\n')
}
