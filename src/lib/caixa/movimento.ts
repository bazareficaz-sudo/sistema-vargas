// Regras puras do ledger de caixa (Fase 1 — só tesouraria).
//
// Fica separado de tela e de rota de propósito: é a parte do caixa que mexe
// em dinheiro, e dinheiro que só existe dentro de um componente React não
// tem como ser conferido nem testado. Mesmo padrão de
// `src/lib/financeiro/pagamento.ts` — a única lógica financeira do sistema
// que já era pura e testada antes desta fase.

export type TipoMovimento = 'entrada' | 'saida'

export type NaturezaMovimento = 'aporte' | 'retirada_socio' | 'deposito_banco' | 'ajuste'

// Só o que a Fase 1 sabe gravar. Sangria/suprimento (Fase 2), pagamento de
// conta e recebimento (Fases 4/5) entram aqui quando as fases que os
// produzem existirem — não antes.
export const NATUREZAS_FASE_1: NaturezaMovimento[] = [
  'aporte', 'retirada_socio', 'deposito_banco', 'ajuste',
]

// O tipo que cada natureza exige. 'ajuste' fica de fora: corrige uma
// contagem e pode ir em qualquer direção.
const TIPO_DA_NATUREZA: Partial<Record<NaturezaMovimento, TipoMovimento>> = {
  aporte: 'entrada',
  retirada_socio: 'saida',
  deposito_banco: 'saida',
}

export type FormaPagamentoCaixa = 'dinheiro' | 'pix' | 'transferencia'

export const FORMAS_PAGAMENTO_CAIXA: FormaPagamentoCaixa[] = ['dinheiro', 'pix', 'transferencia']

function centavos(v: number) {
  return Math.round(v * 100) / 100
}

export type NovoMovimentoInput = {
  tipo?: unknown
  natureza?: unknown
  valor?: unknown
  forma_pagamento?: unknown
  observacao?: unknown
}

export type NovoMovimentoValido = {
  tipo: TipoMovimento
  natureza: NaturezaMovimento
  valor: number
  forma_pagamento: FormaPagamentoCaixa | null
  observacao: string | null
}

export type ResultadoValidacao =
  | { ok: true; movimento: NovoMovimentoValido }
  | { ok: false; erro: string }

/**
 * O contrato de "o que pode nascer no ledger" nesta fase. A rota de servidor
 * chama isto antes de qualquer INSERT — nenhuma validação de payload vive
 * só na tela.
 */
export function validarNovoMovimento(input: NovoMovimentoInput): ResultadoValidacao {
  const natureza = input.natureza
  if (typeof natureza !== 'string' || !NATUREZAS_FASE_1.includes(natureza as NaturezaMovimento)) {
    return { ok: false, erro: 'Natureza inválida para esta fase do caixa.' }
  }

  const tipo = input.tipo
  if (tipo !== 'entrada' && tipo !== 'saida') {
    return { ok: false, erro: 'Tipo deve ser entrada ou saída.' }
  }

  const tipoEsperado = TIPO_DA_NATUREZA[natureza as NaturezaMovimento]
  if (tipoEsperado && tipo !== tipoEsperado) {
    return {
      ok: false,
      erro: `"${natureza}" só pode ser ${tipoEsperado === 'entrada' ? 'entrada' : 'saída'}.`,
    }
  }

  const valorNumero = Number(input.valor)
  if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
    return { ok: false, erro: 'Valor deve ser maior que zero.' }
  }

  let forma_pagamento: FormaPagamentoCaixa | null = null
  if (input.forma_pagamento != null && input.forma_pagamento !== '') {
    if (typeof input.forma_pagamento !== 'string' || !FORMAS_PAGAMENTO_CAIXA.includes(input.forma_pagamento as FormaPagamentoCaixa)) {
      return { ok: false, erro: 'Forma de pagamento inválida.' }
    }
    forma_pagamento = input.forma_pagamento as FormaPagamentoCaixa
  }

  let observacao: string | null = null
  if (input.observacao != null && String(input.observacao).trim() !== '') {
    observacao = String(input.observacao).trim().slice(0, 500)
  }

  return {
    ok: true,
    movimento: { tipo, natureza: natureza as NaturezaMovimento, valor: centavos(valorNumero), forma_pagamento, observacao },
  }
}

export type MovimentoParaSaldo = { tipo: TipoMovimento; valor: number }

/**
 * Saldo é sempre a soma dos movimentos — nunca uma coluna gravada (o
 * sistema já tem um caso documentado de saldo-em-coluna divergindo do real,
 * em produto_estoque × produtos.estoque; não repetir aqui). Um estorno é só
 * um movimento novo de sinal contrário, então ele já entra nesta soma sem
 * tratamento especial.
 */
export function calcularSaldo(movimentos: MovimentoParaSaldo[]): number {
  const totalCentavos = movimentos.reduce((soma, m) => {
    const v = Math.round(m.valor * 100)
    return m.tipo === 'entrada' ? soma + v : soma - v
  }, 0)
  return totalCentavos / 100
}

export type MovimentoExistente = {
  id: string
  tipo: TipoMovimento
  natureza: NaturezaMovimento
  valor: number
  estorno_de_id: string | null
}

export type NovoEstorno = {
  tipo: TipoMovimento
  natureza: NaturezaMovimento
  valor: number
  estorno_de_id: string
}

export type ResultadoEstorno =
  | { ok: true; estorno: NovoEstorno }
  | { ok: false; erro: string }

/**
 * Reverter é lançar um movimento novo de sinal contrário — nunca UPDATE/
 * DELETE no original (seção K.5 da auditoria). `jaEstornados` é o conjunto
 * de ids que já têm um estorno lançado; o índice único do banco
 * (`idx_caixa_movimento_estorno_unico`) é quem garante isto sob concorrência
 * — esta função é a mesma regra, checada antes do INSERT para devolver um
 * erro legível em vez de estourar a constraint.
 */
export function prepararEstorno(
  original: MovimentoExistente,
  jaEstornados: Set<string>,
): ResultadoEstorno {
  if (original.estorno_de_id) {
    return { ok: false, erro: 'Um estorno não pode ser estornado — lance o movimento original de novo.' }
  }
  if (jaEstornados.has(original.id)) {
    return { ok: false, erro: 'Este movimento já foi estornado.' }
  }
  return {
    ok: true,
    estorno: {
      tipo: original.tipo === 'entrada' ? 'saida' : 'entrada',
      natureza: original.natureza,
      valor: original.valor,
      estorno_de_id: original.id,
    },
  }
}
