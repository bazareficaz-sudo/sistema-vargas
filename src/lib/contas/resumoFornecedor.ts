// RESUMO DO QUE SE DEVE A UM FORNECEDOR.
//
// Três perguntas que quem paga faz nessa ordem: o que já venceu, o que vence
// ainda este mês, e o que vai cair no mês que vem.
//
// TUDO EM TEXTO ISO, sem `new Date`. Vencimento é DATE no banco — dia, não
// instante. `new Date('2026-09-01')` interpreta como UTC e, no fuso do
// Brasil, volta para 31/08: uma conta do dia 1º apareceria como vencida no
// dia 1º. Comparar 'YYYY-MM-DD' como string dá a mesma ordem do calendário e
// não tem fuso para errar.

export type ContaParaResumo = {
  vencimento: string | null
  valor: number | string | null
  status?: string | null
}

export type FaixaResumo = { quantidade: number; total: number }

export type ResumoFornecedor = {
  vencido: FaixaResumo
  mesCorrente: FaixaResumo
  mesSeguinte: FaixaResumo
  /** Tudo em aberto, inclusive o que vence depois do mês seguinte. */
  totalAberto: FaixaResumo
  /** O que vence além do mês seguinte — o resto que os três cartões não mostram. */
  depois: FaixaResumo
}

/** `2026-09-01` → `2026-10` */
export function mesSeguinteDe(iso: string): string {
  const ano = Number(iso.slice(0, 4))
  const mes = Number(iso.slice(5, 7))
  return mes === 12
    ? `${ano + 1}-01`
    : `${ano}-${String(mes + 1).padStart(2, '0')}`
}

const zero = (): FaixaResumo => ({ quantidade: 0, total: 0 })

function soma(f: FaixaResumo, valor: number) {
  f.quantidade += 1
  f.total += valor
}

/**
 * Classifica as contas em aberto de um fornecedor.
 *
 * `hoje` entra como parâmetro (ISO 'YYYY-MM-DD') em vez de ser lido do
 * relógio: assim o mesmo lote é classificado contra um único instante, e o
 * teste consegue fixar a data.
 *
 * PAGA E CANCELADA FICAM DE FORA. O resumo responde "quanto ainda devo",
 * não "quanto já movimentei" — somar o que foi pago inflaria os três números
 * e faria o operador pagar de novo.
 *
 * VENCIDO É CALCULADO PELA DATA, não pelo `status`. O status só vira
 * 'vencido' quando a rotina `atualizar_contas_vencidas` roda; entre a virada
 * do dia e a próxima execução, uma conta vencida ainda está 'pendente'. A
 * data não depende de rotina nenhuma ter rodado.
 */
export function resumoDoFornecedor(contas: ContaParaResumo[], hoje: string): ResumoFornecedor {
  const mesAtual = hoje.slice(0, 7)
  const proximo = mesSeguinteDe(hoje)

  const r: ResumoFornecedor = {
    vencido: zero(), mesCorrente: zero(), mesSeguinte: zero(),
    totalAberto: zero(), depois: zero(),
  }

  for (const c of contas) {
    if (c.status === 'pago' || c.status === 'cancelado') continue
    const venc = String(c.vencimento ?? '').slice(0, 10)
    if (!venc) continue
    const valor = Number(c.valor ?? 0)

    soma(r.totalAberto, valor)

    if (venc < hoje) soma(r.vencido, valor)
    else if (venc.slice(0, 7) === mesAtual) soma(r.mesCorrente, valor)
    else if (venc.slice(0, 7) === proximo) soma(r.mesSeguinte, valor)
    else soma(r.depois, valor)
  }

  return r
}
