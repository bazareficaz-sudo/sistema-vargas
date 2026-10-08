// Regras do Getúlio que não dependem de banco — os limiares de "fora do
// normal", a escolha do que entra no resumo e o texto de reserva. Ficam
// aqui, puras, para serem testadas: um limiar mal escolhido não quebra
// nada, só transforma o Getúlio em spam ou em silêncio.

import { ORDEM_GRAVIDADE, PRIORIDADE_VIGIA, type Gravidade, type Sinal } from './tipos'

export function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

// ── Vendas por canal ────────────────────────────────────────────────────

export type LinhaVendasCanal = {
  canal_id: string | null; canal: string; plataforma: string
  ult7_valor: number; ult7_qtd: number; ant28_valor: number; ant28_qtd: number
}

/** Canal pequeno demais oscila à toa: abaixo disto por semana, não avisa. */
export const VENDA_SEMANAL_MINIMA = 300
export const QUEDA_RELEVANTE = -0.3
export const ALTA_RELEVANTE = 0.4

/**
 * Semana atual contra a média semanal das 4 anteriores. Queda vira
 * "atenção", alta vira "oportunidade" (descobrir o que funcionou).
 */
export function avaliarVendasCanal(l: LinhaVendasCanal): Sinal | null {
  const media = Number(l.ant28_valor) / 4
  if (!(media >= VENDA_SEMANAL_MINIMA)) return null
  const atual = Number(l.ult7_valor)
  const variacao = atual / media - 1
  const id = l.canal_id ?? 'pdv'
  const pct = Math.round(Math.abs(variacao) * 100)
  if (variacao <= QUEDA_RELEVANTE) {
    return {
      vigia: 'vendas_canal', chave: `vendas:queda:${id}`, gravidade: 'atencao',
      titulo: `${l.canal}: vendas caíram ${pct}% na semana`,
      detalhe: `${fmtMoeda(atual)} nos últimos 7 dias, contra a média de ${fmtMoeda(media)} por semana nas 4 anteriores.`,
      valor: Math.round(media - atual),
      link: l.canal_id ? `/dashboard/marketplaces/${l.canal_id}` : '/dashboard/vendas',
      dados: { atual, media, variacao, pedidos: Number(l.ult7_qtd) },
    }
  }
  if (variacao >= ALTA_RELEVANTE) {
    return {
      vigia: 'vendas_canal', chave: `vendas:alta:${id}`, gravidade: 'oportunidade',
      titulo: `${l.canal}: vendas subiram ${pct}% na semana`,
      detalhe: `${fmtMoeda(atual)} nos últimos 7 dias, contra a média de ${fmtMoeda(media)} por semana. Vale ver o que puxou a alta e garantir estoque.`,
      valor: Math.round(atual - media),
      link: l.canal_id ? `/dashboard/marketplaces/${l.canal_id}` : '/dashboard/vendas',
      dados: { atual, media, variacao, pedidos: Number(l.ult7_qtd) },
    }
  }
  return null
}

// ── Giro de produto ─────────────────────────────────────────────────────

export type LinhaGiro = {
  produto_id: string; nome: string; sku: string | null
  estoque: number; custo: number; vend7: number; vend28ant: number; ultima_venda: string | null
}

/**
 * Vai faltar: produto que VENDE e tem estoque para pouco tempo.
 *   • ritmo normal (35 dias) e estoque para menos de 7 dias; ou
 *   • disparou (semana ≥ 3× a média e ≥ 5 un., com histórico) e o estoque
 *     no ritmo novo dura menos de 14 dias.
 * "Disparou" sozinho foi medido como ruído (56 produtos, muitos parafusos
 * vendidos por unidade); o que pede ação é disparar E acabar.
 */
export function avaliarVaiFaltar(g: LinhaGiro): Sinal | null {
  const estoque = Number(g.estoque)
  if (!(estoque > 0)) return null
  const vend7 = Number(g.vend7)
  const base = Number(g.vend28ant) / 4
  const ritmoNormal = (vend7 + Number(g.vend28ant)) / 35
  const disparou = vend7 >= 5 && Number(g.vend28ant) >= 4 && vend7 >= 3 * base
  const ritmo = disparou ? vend7 / 7 : ritmoNormal
  if (!(ritmo >= 0.2)) return null
  const dias = estoque / ritmo
  const limite = disparou ? 14 : 7
  if (dias >= limite) return null
  const diasTxt = dias < 1 ? 'menos de 1 dia' : `${Math.floor(dias)} dia(s)`
  return {
    vigia: 'vai_faltar', chave: `produto:vai_faltar:${g.produto_id}`,
    gravidade: dias < 3 ? 'urgente' : 'atencao',
    titulo: disparou ? `${g.nome} disparou e acaba em ${diasTxt}` : `${g.nome} acaba em ${diasTxt}`,
    detalhe: disparou
      ? `Vendeu ${vend7} un. em 7 dias (média de ${base.toFixed(1)} por semana). Estoque: ${estoque} un.`
      : `Vende ~${(ritmo * 7).toFixed(1)} un. por semana e tem ${estoque} un. em estoque.`,
    valor: Math.round(ritmo * 7 * Number(g.custo || 0)),
    link: `/dashboard/produtos?editar=${g.produto_id}`,
    dados: { estoque, vend7, mediaSemanal: base, dias: Number(dias.toFixed(1)), disparou, sku: g.sku },
  }
}

/** Assinatura curta de uma lista (ids, valores) — muda quando a lista muda. */
export function assinar(partes: (string | number)[]): string {
  let h = 5381
  for (const c of partes.map(String).sort().join('|')) h = ((h << 5) + h + c.charCodeAt(0)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Um aviso só para tudo que vai faltar. Medido em 07/10/2026: avisos por
 * produto ocupavam metade do resumo com itens de R$ 3 a R$ 12, e o "canal
 * recusando tudo" ficava de fora. O detalhe lista os que acabam primeiro.
 */
export function agruparVaiFaltar(sinais: Sinal[]): Sinal | null {
  if (sinais.length === 0) return null
  const ordenados = [...sinais].sort((a, b) => Number(a.dados?.dias ?? 99) - Number(b.dados?.dias ?? 99))
  const urgente = ordenados.some(s => s.gravidade === 'urgente')
  const nome = (s: Sinal) => s.titulo.replace(/ (disparou e )?acaba em .*$/, '')
  const quando = (s: Sinal) => {
    const d = Number(s.dados?.dias ?? 0)
    return d < 1 ? 'menos de 1 dia' : `${Math.floor(d)} dia(s)`
  }
  const itens = ordenados.slice(0, 6).map(s => `${nome(s)} (${quando(s)}${s.dados?.disparou ? ', vendendo acima do normal' : ''})`)
  return {
    vigia: 'vai_faltar', chave: 'produto:vai_faltar', gravidade: urgente ? 'urgente' : 'atencao',
    titulo: `${sinais.length} produto(s) vão faltar em breve`,
    detalhe: `No ritmo de venda atual: ${itens.join('; ')}${sinais.length > 6 ? ` e mais ${sinais.length - 6}` : ''}. Hora de repor.`,
    valor: sinais.reduce((s, x) => s + Number(x.valor ?? 0), 0),
    link: '/dashboard/auxiliar-compras',
    dados: {
      produtos: ordenados.map(s => ({ chave: s.chave, titulo: s.titulo, dias: s.dados?.dias })),
      // Avisa de novo quando entra produto novo na lista.
      assinatura: assinar(ordenados.map(s => s.chave)),
    },
  }
}

export const DIAS_PARADO = 60

/** Um sinal só com o total parado e os maiores — 400 avisos não servem a ninguém. */
export function avaliarEstoqueParado(giro: LinhaGiro[], agora: Date): Sinal | null {
  const corte = agora.getTime() - DIAS_PARADO * 86_400_000
  const parados = giro
    .filter(g => Number(g.estoque) > 0 && Number(g.custo) > 0)
    .filter(g => !g.ultima_venda || new Date(g.ultima_venda).getTime() < corte)
    .map(g => ({ id: g.produto_id, nome: g.nome, valor: Number(g.estoque) * Number(g.custo), estoque: Number(g.estoque), ultima_venda: g.ultima_venda }))
    .sort((a, b) => b.valor - a.valor)
  const total = parados.reduce((s, p) => s + p.valor, 0)
  if (total < 1000) return null
  const maiores = parados.slice(0, 5)
  return {
    vigia: 'estoque_parado', chave: 'estoque:parado', gravidade: 'atencao',
    titulo: `${fmtMoeda(total)} parados em ${parados.length} produtos sem venda há ${DIAS_PARADO}+ dias`,
    detalhe: `Os maiores: ${maiores.map(p => `${p.nome} (${fmtMoeda(p.valor)})`).join('; ')}.`,
    valor: Math.round(total),
    link: '/dashboard/relatorios/estoque',
    dados: { quantidade: parados.length, maiores },
  }
}

// ── Integrações ─────────────────────────────────────────────────────────

/** Ids e números mudam entre linhas do mesmo problema; o motivo não. */
export function normalizarErro(msg: string): string {
  return String(msg ?? '')
    .replace(/\/[A-Za-z_]*\/?\d{5,}/g, '/#')
    .replace(/\b(MLB|MLBU)?\d{5,}\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

// ── Motivos de reprovação da TikTok, em português ───────────────────────

const MOTIVOS_TIKTOK: Record<string, string> = {
  'Abnormally Low Pricing': 'preço muito abaixo de produtos parecidos',
  'Prohibited Product': 'produto proibido na TikTok',
  'Prohibited Product - Category Currently Not Open': 'categoria ainda não liberada na TikTok',
  'Hazardous dangerous items': 'item considerado perigoso',
}

export function traduzirMotivos(motivos: string[]): string {
  const vistos = new Set<string>()
  for (const m of motivos) vistos.add(MOTIVOS_TIKTOK[m.trim()] ?? m.trim())
  return [...vistos].join('; ')
}

// ── Relógio de São Paulo ────────────────────────────────────────────────

/** Minutos desde a meia-noite em São Paulo (UTC−3, sem horário de verão). */
export function minutosDoDiaSP(agora: Date): number {
  const d = new Date(agora.getTime() - 3 * 3_600_000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

export function minutosDoHorario(hhmm: string): number {
  const m = String(hhmm ?? '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 7 * 60 + 30
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]))
}

// ── O que entra no resumo ───────────────────────────────────────────────

export type SinalGuardado = Sinal & {
  id: string
  detectado_em: string
  avisado_em: string | null
  dispensado_em: string | null
  /** Quando virou novidade (nasceu, reabriu, mudou ou piorou). */
  novidade_em?: string | null
}

/** Urgente ainda aberto volta a ser lembrado depois deste tempo. */
export const LEMBRETE_URGENTE_H = 48
export const MAX_ITENS_RESUMO = 6

/**
 * Entra no resumo: o que é NOVO (nunca avisado) e o urgente que continua
 * aberto há mais de 48h desde o último aviso. Dispensado não entra.
 * Ordem: gravidade, depois dinheiro em jogo.
 */
export function selecionarParaResumo(sinais: SinalGuardado[], agora: Date): { itens: SinalGuardado[]; restantes: number } {
  const lembrarAntesDe = agora.getTime() - LEMBRETE_URGENTE_H * 3_600_000
  const elegiveis = sinais
    .filter(s => !s.dispensado_em)
    .filter(s => !s.avisado_em || (s.gravidade === 'urgente' && new Date(s.avisado_em).getTime() < lembrarAntesDe))
    .sort((a, b) =>
      ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade]
      || (PRIORIDADE_VIGIA[a.vigia] ?? 9) - (PRIORIDADE_VIGIA[b.vigia] ?? 9)
      || (Number(b.valor ?? 0) - Number(a.valor ?? 0)))
  return { itens: elegiveis.slice(0, MAX_ITENS_RESUMO), restantes: Math.max(0, elegiveis.length - MAX_ITENS_RESUMO) }
}

export const ICONE: Record<Gravidade, string> = { urgente: '🔴', atencao: '🟡', oportunidade: '🟢', info: 'ℹ️' }

/** Bom dia / boa tarde / boa noite pelo relógio de São Paulo. */
export function saudacao(agora: Date, nome: string): string {
  const h = Math.floor(minutosDoDiaSP(agora) / 60)
  const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
  const emoji = h < 12 ? '☀️' : h < 18 ? '🌤️' : '🌙'
  return `${emoji} *${periodo}${nome ? `, ${nome}` : ''}. Getúlio aqui.*`
}

export const SEM_NOVIDADE = 'Passei por tudo e não achei nada fora do normal. Bom trabalho! 👊'

/**
 * O corpo escrito sem IA — reserva para quando ela falhar, e a referência
 * do que a IA precisa entregar no mínimo: tudo que está aqui, com os
 * mesmos números.
 */
export function corpoModelo(itens: SinalGuardado[]): string {
  if (itens.length === 0) return SEM_NOVIDADE
  return itens.map((s, i) => `${i + 1}. ${ICONE[s.gravidade]} *${s.titulo}*\n${s.detalhe}`).join('\n\n')
}

/** Saudação + corpo + rodapé com o que ficou de fora e o link da Central. */
export function montarMensagem(cabecalho: string, corpo: string, restantes: number, linkCentral: string): string {
  const mais = restantes > 0 ? `\n\nE mais ${restantes} assunto(s) na Central do Getúlio.` : ''
  return `${cabecalho}\n\n${corpo.trim()}${mais}\n\n👉 ${linkCentral}`
}

// ── Alerta imediato ─────────────────────────────────────────────────────
//
// O que não pode esperar o resumo do dia seguinte: canal recusando tudo,
// produto zerado à venda, pedido com prazo vencido. Só o URGENTE desses três,
// só o que virou novidade nas últimas 3 horas (ligar o Getúlio não dispara o
// passivo inteiro de uma vez — isso é do resumo), fora da madrugada e no
// máximo 4 por dia.

export const VIGIAS_ALERTA_IMEDIATO = new Set(['integracoes', 'zerado_a_venda', 'pedidos_atrasados'])
export const MAX_ALERTAS_DIA = 4
export const JANELA_NOVIDADE_H = 3
/** Das 7h às 21h, horário de Brasília. */
export const HORARIO_ALERTA = { inicio: 7 * 60, fim: 21 * 60 }

export function horarioDeAlerta(agora: Date): boolean {
  const m = minutosDoDiaSP(agora)
  return m >= HORARIO_ALERTA.inicio && m < HORARIO_ALERTA.fim
}

export function selecionarAlertas(sinais: SinalGuardado[], agora: Date, jaEnviadosHoje: number): SinalGuardado[] {
  const vagas = Math.max(0, MAX_ALERTAS_DIA - jaEnviadosHoje)
  if (vagas === 0 || !horarioDeAlerta(agora)) return []
  const desde = agora.getTime() - JANELA_NOVIDADE_H * 3_600_000
  return sinais
    .filter(s => s.gravidade === 'urgente' && VIGIAS_ALERTA_IMEDIATO.has(s.vigia))
    .filter(s => !s.avisado_em && !s.dispensado_em)
    .filter(s => new Date(s.novidade_em ?? s.detectado_em).getTime() >= desde)
    .sort((a, b) => (PRIORIDADE_VIGIA[a.vigia] ?? 9) - (PRIORIDADE_VIGIA[b.vigia] ?? 9))
    .slice(0, vagas)
}

export function textoAlerta(s: SinalGuardado, link: string): string {
  return `🔴 *Getúlio — isso não pode esperar*

*${s.titulo}*
${s.detalhe}

👉 ${link}

_Responda "não me avise disso" se não quiser mais este aviso._`
}

// ── Resumo semanal (segunda-feira) ──────────────────────────────────────

export type LinhaSemana = { canal: string; faturamento: number }

const variacaoTxt = (atual: number, anterior: number) => {
  if (!(anterior > 0)) return atual > 0 ? ' (novo)' : ''
  const v = Math.round((atual / anterior - 1) * 100)
  return v === 0 ? ' (=)' : ` (${v > 0 ? '▲' : '▼'}${Math.abs(v)}%)`
}

/**
 * Bloco da semana que acabou contra a anterior, por canal. Números exatos,
 * sem IA — vai antes dos avisos no resumo de segunda.
 */
export function blocoSemanal(atual: LinhaSemana[], anterior: LinhaSemana[], rotulo: string): string {
  const totalA = atual.reduce((s, l) => s + Number(l.faturamento), 0)
  const totalB = anterior.reduce((s, l) => s + Number(l.faturamento), 0)
  const porCanal = new Map<string, { a: number; b: number }>()
  for (const l of atual) porCanal.set(l.canal, { a: Number(l.faturamento), b: porCanal.get(l.canal)?.b ?? 0 })
  for (const l of anterior) porCanal.set(l.canal, { a: porCanal.get(l.canal)?.a ?? 0, b: Number(l.faturamento) })
  const linhas = [...porCanal]
    .filter(([, v]) => v.a > 0 || v.b > 0)
    .sort((x, y) => y[1].a - x[1].a)
    .map(([canal, v]) => `• ${canal}: ${fmtMoeda(v.a)}${variacaoTxt(v.a, v.b)}`)
  return [`📊 *Semana passada (${rotulo}): ${fmtMoeda(totalA)}*${variacaoTxt(totalA, totalB)} contra a semana anterior`, ...linhas].join('\n')
}
