// O pagamento de uma venda — regras puras (Fase 4C.1).
//
// A entidade é `venda_pagamento`; `vendas.pagamentos` continua existindo
// como projeção derivada, para a emissão fiscal, o trigger da carteira, o
// comprovante e a tela de vendas seguirem funcionando sem mudança. Ver
// `docs/auditoria/ADR-001-MODELO-DE-PAGAMENTOS.md`.
//
// NADA AQUI ESCREVE NO BANCO. A ingestão é da 4C.2 e a integração com o
// ledger, da 4E. O que está aqui é a aritmética e a validação, conferíveis
// sem banco — mesmo padrão de `lib/caixa/movimento.ts`.

import { FORMAS_PAGAMENTO_VALIDAS } from '@/lib/pdv/formasPagamento'

/**
 * As formas que a coluna aceita.
 *
 * É a lista canônica de `formasPagamento.ts` mais o legado que existe em
 * produção: `devolucao` e `marketplace` aparecem em vendas reais, e
 * `credito_cliente` é como o Electron chama a carteira em um dos caminhos.
 * Recusá-los faria o servidor rejeitar dado que já existe.
 */
export const FORMAS_ACEITAS: readonly string[] = [
  ...FORMAS_PAGAMENTO_VALIDAS,
  'devolucao', 'marketplace', 'credito_cliente',
]

/**
 * As formas que movimentam dinheiro físico.
 *
 * É uma lista de UM elemento, e essa é a regra inteira: só espécie entra na
 * gaveta. Cartão, PIX e carteira são pagamento da venda, não entrada de
 * caixa — o total da venda nunca é o efeito na gaveta.
 *
 * Usada só para derivar o efeito futuro; nada é lançado nesta fase.
 */
export const FORMAS_EM_ESPECIE: readonly string[] = ['dinheiro']

export function ehEspecie(forma: string): boolean {
  return FORMAS_EM_ESPECIE.includes(forma)
}

export type PagamentoEntrada = {
  id?: unknown
  forma?: unknown
  valor?: unknown
  valor_entregue?: unknown
  troco?: unknown
  sequencia?: unknown
}

export type PagamentoValido = {
  id: string
  forma: string
  valor: number
  valor_entregue: number | null
  troco: number | null
  sequencia: number
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function centavos(v: number) {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? 0 : r
}

/**
 * Valida UM pagamento.
 *
 * `id` é obrigatório e vem da origem: é a chave de idempotência. Gerar um
 * aqui faria cada retry criar um pagamento novo — e como uma venda pode ter
 * dois cartões de R$ 50, não há como distinguir duplicata de pagamento
 * legítimo por (forma, valor).
 */
export function validarPagamento(p: PagamentoEntrada, indice = 0): Resultado<PagamentoValido> {
  const id = typeof p.id === 'string' ? p.id : ''
  if (!UUID.test(id)) {
    return { ok: false, erro: `Pagamento ${indice + 1}: identificador ausente ou inválido.` }
  }

  const forma = typeof p.forma === 'string' ? p.forma : ''
  if (!FORMAS_ACEITAS.includes(forma)) {
    return { ok: false, erro: `Pagamento ${indice + 1}: forma "${forma}" não reconhecida.` }
  }

  const valor = Number(p.valor)
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, erro: `Pagamento ${indice + 1}: valor deve ser maior que zero.` }
  }

  // Entregue e troco só existem em espécie. Preencher "entregue = valor"
  // num cartão inventaria um troco de zero que nunca houve.
  let valor_entregue: number | null = null
  let troco: number | null = null

  if (p.valor_entregue != null && p.valor_entregue !== '') {
    if (!ehEspecie(forma)) {
      return { ok: false, erro: `Pagamento ${indice + 1}: só pagamento em dinheiro tem valor entregue.` }
    }
    const e = Number(p.valor_entregue)
    if (!Number.isFinite(e) || e < valor) {
      return { ok: false, erro: `Pagamento ${indice + 1}: o valor entregue não cobre o valor aplicado.` }
    }
    valor_entregue = centavos(e)
    troco = centavos(valor_entregue - centavos(valor))
  }

  // Troco informado sem valor entregue não tem de onde ser conferido.
  if (p.troco != null && p.troco !== '' && valor_entregue === null) {
    return { ok: false, erro: `Pagamento ${indice + 1}: troco exige o valor entregue.` }
  }
  if (p.troco != null && p.troco !== '' && centavos(Number(p.troco)) !== troco) {
    return { ok: false, erro: `Pagamento ${indice + 1}: o troco não confere com entregue menos aplicado.` }
  }

  const seq = p.sequencia == null || p.sequencia === '' ? indice + 1 : Number(p.sequencia)
  if (!Number.isInteger(seq) || seq <= 0) {
    return { ok: false, erro: `Pagamento ${indice + 1}: sequência inválida.` }
  }

  return { ok: true, valor: { id, forma, valor: centavos(valor), valor_entregue, troco, sequencia: seq } }
}

/**
 * Valida a lista inteira e confere a soma.
 *
 * A soma é validada AQUI e não por CHECK no banco. Três razões medidas:
 * `vendas.total` já traz devoluções embutidas, existem 18 vendas com total
 * negativo, e o jsonb legado guarda float — há em produção um
 * `197.32000000000002`. Um CHECK de igualdade exata recusaria dado
 * legítimo.
 *
 * A comparação é em centavos arredondados, pelo mesmo motivo.
 */
export function validarPagamentosDaVenda(
  lista: PagamentoEntrada[],
  valorAPagar: number,
): Resultado<PagamentoValido[]> {
  if (!Array.isArray(lista) || lista.length === 0) {
    return { ok: false, erro: 'Informe ao menos um pagamento.' }
  }

  const ids = new Set<string>()
  const validos: PagamentoValido[] = []

  for (let i = 0; i < lista.length; i++) {
    const r = validarPagamento(lista[i], i)
    if (!r.ok) return r
    // Dois pagamentos com o MESMO id são duplicata; dois com a mesma forma e
    // o mesmo valor são dois cartões, e isso é legítimo.
    if (ids.has(r.valor.id)) {
      return { ok: false, erro: 'Há dois pagamentos com o mesmo identificador.' }
    }
    ids.add(r.valor.id)
    validos.push(r.valor)
  }

  const soma = somarPagamentos(validos)
  if (Math.round(soma * 100) !== Math.round(valorAPagar * 100)) {
    return {
      ok: false,
      erro: `A soma dos pagamentos (${soma.toFixed(2)}) não fecha com o valor a pagar (${valorAPagar.toFixed(2)}).`,
    }
  }

  return { ok: true, valor: validos }
}

/** Soma em centavos, para não acumular erro de ponto flutuante. */
export function somarPagamentos(lista: { valor: number }[]): number {
  return lista.reduce((s, p) => s + Math.round(p.valor * 100), 0) / 100
}

/**
 * Quanto desta venda entra fisicamente na gaveta.
 *
 * É o coração do contrato do ledger: o total da venda NÃO é o efeito no
 * caixa. Venda de R$ 150 com R$ 50 em dinheiro e R$ 100 em cartão move a
 * gaveta em R$ 50 — e é o valor APLICADO, não o entregue: os R$ 100 que o
 * cliente deu e os R$ 50 de troco acontecem no mesmo ato.
 *
 * Nada é lançado nesta fase. A função existe para o contrato ser testável
 * antes de a 4E existir.
 */
export function efeitoNaGaveta(lista: { forma: string; valor: number }[]): number {
  return somarPagamentos(lista.filter(p => ehEspecie(p.forma)))
}

/**
 * A projeção que o trigger gera — reproduzida aqui para poder ser conferida
 * sem banco. Agrupa por forma e desconta os estornos; forma que zera some.
 */
export function projetarPagamentos(
  lista: { forma: string; valor: number; estorno_de_id?: string | null; sequencia?: number }[],
): { forma: string; valor: number }[] {
  const porForma = new Map<string, { centavos: number; seq: number }>()
  for (const p of lista) {
    const sinal = p.estorno_de_id ? -1 : 1
    const atual = porForma.get(p.forma)
    const c = Math.round(p.valor * 100) * sinal
    if (atual) atual.centavos += c
    else porForma.set(p.forma, { centavos: c, seq: p.sequencia ?? 1 })
  }
  return [...porForma.entries()]
    .filter(([, v]) => v.centavos !== 0)
    .sort((a, b) => a[1].seq - b[1].seq)
    .map(([forma, v]) => ({ forma, valor: v.centavos / 100 }))
}

/**
 * O payload legado vira um pagamento só — sem inventar decomposição.
 *
 * É o que mantém o PDV antigo funcionando: ele manda `forma_pagamento` e
 * `total`, e o servidor deriva um pagamento. Mesma regra que
 * `emitirParaVenda.ts` já usa há tempos para a nota fiscal.
 *
 * `misto` devolve `null` DE PROPÓSITO. A forma existe no Electron mas nunca
 * registrou a composição — são 12 vendas em produção onde a parcela em
 * dinheiro é indeterminável. Dividir ao meio, ou chutar qualquer
 * distribuição, seria transformar ausência de informação em informação.
 */
export function derivarDoLegado(
  formaPagamento: string | null | undefined,
  total: number,
): { forma: string; valor: number } | null {
  if (!formaPagamento) return null
  if (formaPagamento === 'misto' || formaPagamento === 'multiplo') return null
  if (!FORMAS_ACEITAS.includes(formaPagamento)) return null
  if (!Number.isFinite(total) || total <= 0) return null
  return { forma: formaPagamento, valor: centavos(total) }
}
