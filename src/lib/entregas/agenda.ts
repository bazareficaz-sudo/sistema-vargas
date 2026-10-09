// Agenda de entregas: como a tela Entregas separa as vendas com entrega.
//
// Uma venda com entrega_solicitada e sem entrega_realizada_em está
// pendente. Para o dia escolhido ela cai em exatamente um lugar:
//   · do dia      — agendada para o dia escolhido;
//   · atrasada    — agendada para antes de HOJE (não do dia escolhido: o
//                   atraso é um fato do relógio, não do filtro);
//   · sem data    — marcada no PDV sem agendamento;
//   · futura      — agendada para outro dia à frente (só entra na contagem
//                   dos botões de data).
// Datas são 'AAAA-MM-DD' no fuso da loja, comparáveis como texto.

export type PeriodoEntrega = 'qualquer' | 'manha' | 'tarde' | 'noite'

export const PERIODOS: { v: PeriodoEntrega; l: string }[] = [
  { v: 'manha', l: 'Manhã' },
  { v: 'tarde', l: 'Tarde' },
  { v: 'noite', l: 'Noite' },
  { v: 'qualquer', l: 'Qualquer horário' },
]

export type EntregaBase = {
  id: string
  entrega_agendada_para: string | null
  entrega_periodo: string | null
  entrega_realizada_em: string | null
}

export type Agenda<T extends EntregaBase> = {
  doDia: { periodo: PeriodoEntrega; rotulo: string; itens: T[] }[]
  atrasadas: T[]
  semData: T[]
  realizadas: T[]
  totalDoDia: number
}

export function periodoDe(v: string | null): PeriodoEntrega {
  return v === 'manha' || v === 'tarde' || v === 'noite' ? v : 'qualquer'
}

const ORDEM_PERIODO: Record<PeriodoEntrega, number> = { manha: 0, tarde: 1, noite: 2, qualquer: 3 }

export function montarAgenda<T extends EntregaBase>(entregas: T[], dia: string, hoje: string): Agenda<T> {
  const pendentes = entregas.filter(e => !e.entrega_realizada_em)
  const doDia = pendentes.filter(e => e.entrega_agendada_para === dia)
  const grupos = PERIODOS.map(p => ({
    periodo: p.v, rotulo: p.l,
    itens: doDia.filter(e => periodoDe(e.entrega_periodo) === p.v),
  })).filter(g => g.itens.length > 0)

  return {
    doDia: grupos,
    atrasadas: pendentes
      .filter(e => e.entrega_agendada_para !== null && e.entrega_agendada_para < hoje && e.entrega_agendada_para !== dia)
      .sort((a, b) => (a.entrega_agendada_para ?? '').localeCompare(b.entrega_agendada_para ?? '')
        || ORDEM_PERIODO[periodoDe(a.entrega_periodo)] - ORDEM_PERIODO[periodoDe(b.entrega_periodo)]),
    semData: pendentes.filter(e => e.entrega_agendada_para === null),
    // Feitas no dia: as agendadas para ele e as sem data entregues nele.
    realizadas: entregas
      .filter(e => e.entrega_realizada_em && (e.entrega_agendada_para
        ? e.entrega_agendada_para === dia
        : diaLocalISO(new Date(e.entrega_realizada_em)) === dia))
      .sort((a, b) => (a.entrega_realizada_em ?? '').localeCompare(b.entrega_realizada_em ?? '')),
    totalDoDia: doDia.length,
  }
}

// Pendentes por data, para o número nos botões de dia.
export function contagemPorDia(entregas: EntregaBase[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of entregas) {
    if (e.entrega_realizada_em || !e.entrega_agendada_para) continue
    m.set(e.entrega_agendada_para, (m.get(e.entrega_agendada_para) ?? 0) + 1)
  }
  return m
}

// 'AAAA-MM-DD' no fuso local (o do navegador da loja).
export function diaLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  return diaLocalISO(new Date(a, m - 1, d + n))
}

export function formatarDia(dia: string): string {
  return dia.split('-').reverse().join('/')
}

// Endereço da entrega sem as partes que a própria tela já mostra em campo
// separado (o texto congelado no PDV junta "Agendado: …" e "Tel: …").
export function enderecoLimpo(texto: string | null): string {
  if (!texto) return ''
  return texto.split(' | ')
    .filter(p => !p.startsWith('Agendado:') && !p.startsWith('Tel:'))
    .join(' | ')
}

export function linkWhatsApp(telefone: string | null): string | null {
  const d = (telefone ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return `https://wa.me/${d.startsWith('55') && d.length >= 12 ? d : `55${d}`}`
}

export function linkMapa(endereco: string): string | null {
  const so = endereco.split(' | ').filter(p => !p.startsWith('Obs:')).join(' ').trim()
  return so ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(so)}` : null
}
