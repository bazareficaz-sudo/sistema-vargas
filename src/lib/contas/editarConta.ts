// EDITAR VALOR E VENCIMENTO DE UMA CONTA A PAGAR em aberto.
//
// Antes, boleto prorrogado ou com valor corrigido era cancelado e lançado de
// novo — perdia a origem (a NF), a parcela e a observação. Editar no lugar
// preserva tudo isso; o que muda é só o valor ou a data.
//
// Três cuidados que valem para qualquer tela que edite:
//  - as DUAS colunas de vencimento (`vencimento` e `data_vencimento`) andam
//    juntas: telas diferentes leem uma ou outra;
//  - a situação acompanha a data nova: prorrogar um boleto vencido para a
//    semana que vem o tira de "vencido";
//  - o valor e o vencimento ORIGINAIS ficam guardados na primeira edição,
//    para quem confere saber que a conta não é mais a da nota.

export type ContaEditavel = {
  valor: number | string | null
  vencimento: string | null
  status: string | null
  valor_original?: number | string | null
  vencimento_original?: string | null
}

export type PatchConta = {
  valor?: number
  vencimento?: string
  data_vencimento?: string
  status?: string
  valor_original?: number
  vencimento_original?: string
}

/**
 * Valor digitado → número. Aceita "1.234,56", "1234,5", "1234.56" e
 * "R$ 99". Ponto seguido de exatamente três dígitos no fim é milhar
 * ("1.234" = mil duzentos e trinta e quatro, como se escreve no Brasil).
 */
export function lerValor(texto: string): number | null {
  let t = String(texto ?? '').replace(/[R$\s]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Math.round(Number(t) * 100) / 100
  return Number.isFinite(n) ? n : null
}

const dataValida = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())

/**
 * O que gravar para a mudança pedida. `null` em `patch` quando nada mudou.
 * Conta paga ou cancelada não se edita aqui: mexer no valor de algo já pago
 * desmancharia o registro do pagamento.
 */
export function patchDaEdicao(
  conta: ContaEditavel,
  mudanca: { valor?: number | null; vencimento?: string | null },
  hoje: string,
): { patch: PatchConta | null; erro?: string } {
  if (conta.status === 'pago' || conta.status === 'cancelado') {
    return { patch: null, erro: 'Conta paga ou cancelada não pode ser alterada.' }
  }
  const patch: PatchConta = {}
  const valorAtual = Number(conta.valor ?? 0)
  const vencAtual = String(conta.vencimento ?? '').slice(0, 10)

  if (mudanca.valor !== undefined) {
    const v = mudanca.valor
    if (v === null || !(v > 0)) return { patch: null, erro: 'Informe um valor maior que zero.' }
    if (Math.abs(v - valorAtual) >= 0.005) {
      patch.valor = v
      if (conta.valor_original == null) patch.valor_original = valorAtual
    }
  }

  if (mudanca.vencimento !== undefined) {
    const d = String(mudanca.vencimento ?? '')
    if (!dataValida(d)) return { patch: null, erro: 'Informe uma data de vencimento válida.' }
    if (d !== vencAtual) {
      patch.vencimento = d
      patch.data_vencimento = d
      if (!conta.vencimento_original && vencAtual) patch.vencimento_original = vencAtual
    }
  }

  if (!Object.keys(patch).length) return { patch: null }
  const venc = patch.vencimento ?? vencAtual
  const status = venc < hoje ? 'vencido' : 'pendente'
  if (status !== conta.status) patch.status = status
  return { patch }
}
