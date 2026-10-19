// AGENDA DO CONTAS A PAGAR — as perguntas de quem paga boleto:
// quanto está vencido, quanto vence hoje, nesta semana, neste mês e no
// próximo; e, olhando para trás, quanto teve de boleto em cada mês.
//
// Tudo em texto ISO 'YYYY-MM-DD', como em resumoFornecedor.ts: vencimento é
// DATE no banco (dia, não instante), e `new Date('2026-09-01')` no fuso do
// Brasil volta para 31/08. As contas de dia usam Date.UTC só para somar dias
// e saber o dia da semana — sem fuso no meio.
//
// VENCIDO É PELA DATA, não pelo `status`: a rotina que marca 'vencido' roda
// quando alguém abre a tela, e até lá uma conta de ontem ainda é 'pendente'.

export type ContaAgenda = {
  vencimento: string | null
  valor: number | string | null
  status: string | null
  data_pagamento?: string | null
}

export type Situacao = 'aberto' | 'vencido' | 'a_vencer' | 'pago' | 'todos' | 'cancelado'
export type Periodo = 'todos' | 'hoje' | 'semana' | 'proxima_semana' | 'mes' | 'proximo_mes' | 'personalizado'
export type Agrupamento = 'nenhum' | 'dia' | 'semana' | 'mes' | 'fornecedor' | 'empresa'

export type Faixa = { quantidade: number; total: number }
export type FaixaComPago = Faixa & { aberto: Faixa; pago: Faixa }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`)

export function somarDias(iso: string, n: number): string {
  const d = utc(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = domingo … 6 = sábado */
export function diaDaSemana(iso: string): number { return utc(iso).getUTCDay() }

/** A segunda-feira da semana do dia (semana de segunda a domingo). */
export function inicioDaSemana(iso: string): string {
  return somarDias(iso, -((diaDaSemana(iso) + 6) % 7))
}

/** '2026-10' → 1º dia do mês seguinte, '2026-11-01'. */
function primeiroDoMesSeguinte(ym: string): string {
  const [a, m] = ym.split('-').map(Number)
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`
}

export function somarMeses(ym: string, n: number): string {
  const [a, m] = ym.split('-').map(Number)
  const t = a * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export function ultimoDiaDoMes(ym: string): string { return somarDias(primeiroDoMesSeguinte(ym), -1) }

/** '2026-10-19' → '19/10' */
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** '2026-10' → 'outubro de 2026' */
export function rotuloDoMes(ym: string): string {
  const [a, m] = ym.split('-').map(Number)
  return `${MESES[m - 1]} de ${a}`
}

export function nomeDoMes(ym: string): string { return MESES[Number(ym.slice(5, 7)) - 1] }

/** Em que situação a conta está HOJE. */
export function situacaoDaConta(c: ContaAgenda, hoje: string): 'pago' | 'cancelado' | 'vencido' | 'a_vencer' {
  if (c.status === 'pago') return 'pago'
  if (c.status === 'cancelado') return 'cancelado'
  return String(c.vencimento ?? '').slice(0, 10) < hoje ? 'vencido' : 'a_vencer'
}

export function passaNaSituacao(c: ContaAgenda, s: Situacao, hoje: string): boolean {
  const atual = situacaoDaConta(c, hoje)
  if (s === 'aberto') return atual === 'vencido' || atual === 'a_vencer'
  // "Todos" deixa as canceladas de fora: elas não são dinheiro devido nem
  // pago, e somadas ao total dariam um número que não existe.
  if (s === 'todos') return atual !== 'cancelado'
  return atual === s
}

/** De/até (inclusive) do vencimento para cada atalho. null = sem limite. */
export function intervaloDoPeriodo(
  p: Periodo, hoje: string, de?: string | null, ate?: string | null,
): { de: string | null; ate: string | null } {
  const mes = hoje.slice(0, 7)
  const seg = inicioDaSemana(hoje)
  switch (p) {
    case 'hoje': return { de: hoje, ate: hoje }
    case 'semana': return { de: seg, ate: somarDias(seg, 6) }
    case 'proxima_semana': return { de: somarDias(seg, 7), ate: somarDias(seg, 13) }
    case 'mes': return { de: `${mes}-01`, ate: ultimoDiaDoMes(mes) }
    case 'proximo_mes': { const m = somarMeses(mes, 1); return { de: `${m}-01`, ate: ultimoDiaDoMes(m) } }
    case 'personalizado': return { de: de || null, ate: ate || null }
    default: return { de: null, ate: null }
  }
}

export function noIntervalo(venc: string | null, i: { de: string | null; ate: string | null }): boolean {
  if (!i.de && !i.ate) return true
  const v = String(venc ?? '').slice(0, 10)
  if (!v) return false
  return (!i.de || v >= i.de) && (!i.ate || v <= i.ate)
}

const zero = (): Faixa => ({ quantidade: 0, total: 0 })
const zeroComPago = (): FaixaComPago => ({ quantidade: 0, total: 0, aberto: zero(), pago: zero() })
function somar(f: Faixa, v: number) { f.quantidade += 1; f.total += v }
const arred = (n: number) => Math.round(n * 100) / 100

function fechar<T>(o: T): T {
  // Soma de centavos em ponto flutuante deixa 0.30000000000000004 no total.
  for (const v of Object.values(o as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      const f = v as Record<string, unknown>
      if (typeof f.total === 'number') f.total = arred(f.total)
      fechar(f)
    }
  }
  return o
}

export type PainelPagar = {
  vencido: Faixa & { maisAntigo: string | null }
  hoje: Faixa
  semana: FaixaComPago & { de: string; ate: string }
  mes: FaixaComPago & { mes: string }
  proximoMes: FaixaComPago & { mes: string }
  totalAberto: Faixa
}

/**
 * Os cartões do topo. "Semana", "mês" e "próximo mês" respondem "quanto de
 * boleto tem nesse período" — o total do período, separado em o que já foi
 * pago e o que falta. "Vencido" é tudo que passou da data sem pagar, de
 * qualquer mês: é a pergunta "quanto estou devendo atrasado".
 */
export function painelDoPagar(contas: ContaAgenda[], hoje: string): PainelPagar {
  const sem = intervaloDoPeriodo('semana', hoje)
  const mesAtual = hoje.slice(0, 7)
  const proximo = somarMeses(mesAtual, 1)
  const p: PainelPagar = {
    vencido: { ...zero(), maisAntigo: null },
    hoje: zero(),
    semana: { ...zeroComPago(), de: sem.de!, ate: sem.ate! },
    mes: { ...zeroComPago(), mes: mesAtual },
    proximoMes: { ...zeroComPago(), mes: proximo },
    totalAberto: zero(),
  }

  for (const c of contas) {
    const s = situacaoDaConta(c, hoje)
    if (s === 'cancelado') continue
    const venc = String(c.vencimento ?? '').slice(0, 10)
    if (!venc) continue
    const valor = Number(c.valor ?? 0)
    const aberto = s !== 'pago'

    if (aberto) somar(p.totalAberto, valor)
    if (s === 'vencido') {
      somar(p.vencido, valor)
      if (!p.vencido.maisAntigo || venc < p.vencido.maisAntigo) p.vencido.maisAntigo = venc
    }
    if (aberto && venc === hoje) somar(p.hoje, valor)

    const faixas: FaixaComPago[] = []
    if (venc >= sem.de! && venc <= sem.ate!) faixas.push(p.semana)
    if (venc.slice(0, 7) === mesAtual) faixas.push(p.mes)
    if (venc.slice(0, 7) === proximo) faixas.push(p.proximoMes)
    for (const f of faixas) {
      somar(f, valor)
      somar(aberto ? f.aberto : f.pago, valor)
    }
  }
  return fechar(p)
}

/**
 * Chave e rótulo do grupo de uma conta na lista agrupada.
 *
 * Por dia e por semana, o que está VENCIDO e em aberto vai todo para um grupo
 * só, "Em atraso", no topo: espalhado pelas semanas passadas, o atraso de
 * agosto ficaria escondido entre boletos já pagos.
 */
export function grupoDaConta(
  c: ContaAgenda & { fornecedorNome?: string; empresaNome?: string },
  por: Agrupamento, hoje: string,
): { chave: string; rotulo: string; atraso?: boolean } {
  const venc = String(c.vencimento ?? '').slice(0, 10)
  if (por === 'empresa') {
    const nome = c.empresaNome || 'Empresa'
    return { chave: nome.toLocaleLowerCase('pt-BR'), rotulo: nome }
  }
  if (por === 'fornecedor') {
    const nome = c.fornecedorNome || '(sem fornecedor)'
    return { chave: nome.toLocaleLowerCase('pt-BR'), rotulo: nome }
  }
  if (!venc) return { chave: '9999', rotulo: 'Sem vencimento' }
  if ((por === 'dia' || por === 'semana') && situacaoDaConta(c, hoje) === 'vencido') {
    return { chave: '0000', rotulo: 'Em atraso', atraso: true }
  }
  if (por === 'dia') {
    const nome = venc === hoje ? 'Hoje' : venc === somarDias(hoje, 1) ? 'Amanhã' : venc === somarDias(hoje, -1) ? 'Ontem' : null
    const dia = `${DIAS[diaDaSemana(venc)]} ${diaMes(venc)}`
    return { chave: venc, rotulo: nome ? `${nome} · ${dia}` : dia }
  }
  if (por === 'semana') {
    const seg = inicioDaSemana(venc)
    const esta = inicioDaSemana(hoje)
    const nome = seg === esta ? 'Esta semana' : seg === somarDias(esta, 7) ? 'Semana que vem' : seg === somarDias(esta, -7) ? 'Semana passada' : 'Semana'
    return { chave: seg, rotulo: `${nome} · ${diaMes(seg)} a ${diaMes(somarDias(seg, 6))}` }
  }
  if (por === 'mes') {
    const ym = venc.slice(0, 7)
    const r = rotuloDoMes(ym)
    return { chave: ym, rotulo: ym === hoje.slice(0, 7) ? `${r} (este mês)` : r }
  }
  return { chave: '', rotulo: '' }
}

export type LinhaMes = {
  mes: string
  /** Boletos com vencimento no mês, pelo valor original. */
  total: Faixa
  pago: Faixa
  /** Em aberto e já vencido (só existe em mês que já começou). */
  vencido: Faixa
  aVencer: Faixa
}

/**
 * Mês a mês pelo VENCIMENTO: quanto teve de boleto em cada mês, quanto
 * disso foi pago e quanto ficou para trás. É o "quanto teve esse mês e
 * quanto tem no mês que vem". O dinheiro que saiu do caixa (por data de
 * pagamento, com juros) é outra pergunta, respondida no relatório de
 * pagamentos.
 */
export function mesAMes(contas: ContaAgenda[], hoje: string, antes = 5, depois = 6): LinhaMes[] {
  const atual = hoje.slice(0, 7)
  const linhas = new Map<string, LinhaMes>()
  for (let i = -antes; i <= depois; i++) {
    const m = somarMeses(atual, i)
    linhas.set(m, { mes: m, total: zero(), pago: zero(), vencido: zero(), aVencer: zero() })
  }
  for (const c of contas) {
    const s = situacaoDaConta(c, hoje)
    if (s === 'cancelado') continue
    const l = linhas.get(String(c.vencimento ?? '').slice(0, 7))
    if (!l) continue
    const v = Number(c.valor ?? 0)
    somar(l.total, v)
    somar(s === 'pago' ? l.pago : s === 'vencido' ? l.vencido : l.aVencer, v)
  }
  return [...linhas.values()].map(l => fechar(l))
}

export const FAIXAS_ATRASO = [
  { rotulo: '1 a 7 dias', ate: 7 },
  { rotulo: '8 a 15 dias', ate: 15 },
  { rotulo: '16 a 30 dias', ate: 30 },
  { rotulo: '31 a 60 dias', ate: 60 },
  { rotulo: 'mais de 60 dias', ate: Infinity },
] as const

export function diasEntre(de: string, ate: string): number {
  return Math.round((utc(ate).getTime() - utc(de).getTime()) / 86400000)
}

/** Vencidos em aberto por tempo de atraso. */
export function faixasDeAtraso(contas: ContaAgenda[], hoje: string): (Faixa & { rotulo: string })[] {
  const out = FAIXAS_ATRASO.map(f => ({ rotulo: f.rotulo, ...zero() }))
  for (const c of contas) {
    if (situacaoDaConta(c, hoje) !== 'vencido') continue
    const dias = diasEntre(String(c.vencimento).slice(0, 10), hoje)
    const i = FAIXAS_ATRASO.findIndex(f => dias <= f.ate)
    somar(out[i], Number(c.valor ?? 0))
  }
  return out.map(f => fechar({ x: f }).x)
}

/** As próximas `n` semanas (a atual inclusive), o que está em aberto em cada. */
export function semanasAFrente(contas: ContaAgenda[], hoje: string, n = 8): (Faixa & { de: string; ate: string })[] {
  const seg = inicioDaSemana(hoje)
  const out = Array.from({ length: n }, (_, i) => ({ de: somarDias(seg, i * 7), ate: somarDias(seg, i * 7 + 6), ...zero() }))
  for (const c of contas) {
    if (situacaoDaConta(c, hoje) !== 'a_vencer') continue
    const venc = String(c.vencimento ?? '').slice(0, 10)
    const s = out.find(w => venc >= w.de && venc <= w.ate)
    if (s) somar(s, Number(c.valor ?? 0))
  }
  return out.map(f => fechar({ x: f }).x)
}

/** Linha de CSV para Excel brasileiro: `;`, aspas quando precisa. */
export function linhaCsv(campos: (string | number | null | undefined)[]): string {
  return campos.map(v => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'number') return v.toFixed(2).replace('.', ',')
    const s = String(v)
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(';')
}
