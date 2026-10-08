// A VOZ do Getúlio: escolhe o que entra no resumo, escreve e entrega.
//
// A IA escreve o CORPO a partir dos sinais já calculados — ela ordena,
// junta e dá o tom, mas não calcula nem inventa: os números vêm prontos dos
// vigias. Se ela falhar (ou não estiver configurada), o modelo fixo escreve
// no lugar e a mensagem sai do mesmo jeito.

import { perguntarJSON } from '@/lib/ia/claude'
import { urlDoApp } from '@/lib/appUrl'
import { diaISO, inicioDoDia } from '@/lib/datas'
import { intervaloUTC } from '@/lib/ia/consultas/tipos'
import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'
import {
  ICONE, SEM_NOVIDADE, blocoSemanal, corpoModelo, montarMensagem, saudacao, selecionarAlertas, selecionarParaResumo, textoAlerta,
  type LinhaSemana, type SinalGuardado,
} from './regras'
import type { Destinatario } from './tipos'

export const LINK_CENTRAL = urlDoApp('/dashboard/getulio')

async function sinaisAbertos(sb: any, empresaId: string): Promise<SinalGuardado[]> {
  const { data } = await sb.from('getulio_sinais')
    .select('id, vigia, chave, gravidade, titulo, detalhe, valor, link, dados, detectado_em, novidade_em, avisado_em, dispensado_em')
    .eq('empresa_id', empresaId).is('resolvido_em', null)
  return (data ?? []) as SinalGuardado[]
}

export async function corpoPelaIA(itens: SinalGuardado[]): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const fatos = itens.map((s, i) => ({
    n: i + 1, gravidade: s.gravidade, emoji: ICONE[s.gravidade], titulo: s.titulo, detalhe: s.detalhe,
  }))
  const prompt = [
    'Você é o Getúlio, o assistente de gestão de uma loja de ferragens e utilidades que vende no balcão (PDV) e em marketplaces (Mercado Livre, Shopee, TikTok Shop, loja online).',
    'Escreva o CORPO de uma mensagem de WhatsApp para o dono, em português do Brasil, no tom de um sócio experiente: direto, respeitoso, prático, sem bajulação e sem alarmismo.',
    '',
    'Regras:',
    '- Use SOMENTE os fatos e números abaixo. Não invente causas, números, nomes nem datas. Pode sugerir o que conferir.',
    '- Mantenha a ordem e a numeração. Cada item: "N. EMOJI *título curto*" numa linha e, na seguinte, uma ou duas frases com o que importa e a ação sugerida.',
    '- Formatação de WhatsApp: só *negrito*. Nada de títulos, tabelas ou links.',
    '- Não cumprimente (a saudação já vai antes) e não se despeça.',
    '- No máximo 1.300 caracteres no total.',
    '- Não cite empresas de tecnologia nem ferramentas.',
    '',
    `Fatos: ${JSON.stringify(fatos)}`,
    '',
    'Responda só com JSON: {"corpo": "..."}',
  ].join('\n')
  try {
    const r = await perguntarJSON(prompt)
    const corpo = typeof r?.corpo === 'string' ? r.corpo.trim() : ''
    // Corpo vazio, curto demais ou faltando item é descartado — o modelo
    // fixo é melhor do que uma mensagem que esconde um aviso.
    if (corpo.length < 40 || corpo.length > 2500) return null
    if (!itens.every((_, i) => corpo.includes(`${i + 1}.`))) return null
    return corpo
  } catch {
    return null
  }
}

export type Resumo = {
  texto: string
  geradoPor: 'ia' | 'modelo'
  itens: SinalGuardado[]
  restantes: number
}

/** Segunda-feira em São Paulo? */
export function ehSegunda(agora: Date): boolean {
  return new Date(agora.getTime() - 3 * 3_600_000).getUTCDay() === 1
}

/**
 * A semana que acabou (segunda a domingo) contra a anterior, por canal.
 * Números exatos do banco — a IA não toca neste bloco.
 */
async function semanaQuePassou(sb: any, empresaId: string, agora: Date): Promise<string | null> {
  const dia = (n: number) => diaISO(new Date(agora.getTime() - n * 86_400_000))
  // Hoje é segunda: a semana passada vai de 7 a 1 dia atrás; a anterior, de 14 a 8.
  const ler = async (de: string, ate: string): Promise<LinhaSemana[]> => {
    const { inicio, fim } = intervaloUTC(de, ate)
    const { data, error } = await sb.rpc('getulio_vendas_periodo', { p_empresa: empresaId, p_inicio: inicio, p_fim: fim })
    if (error) throw new Error(error.message)
    return ((data ?? []) as any[]).map(l => ({ canal: l.canal, faturamento: Number(l.faturamento) }))
  }
  try {
    const [atual, anterior] = await Promise.all([ler(dia(7), dia(1)), ler(dia(14), dia(8))])
    const br = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)
    return blocoSemanal(atual, anterior, `${br(dia(7))} a ${br(dia(1))}`)
  } catch {
    return null
  }
}

/** Monta o resumo (sem enviar). `nome` entra na saudação. */
export async function montarResumo(
  sb: any, empresaId: string, nome: string, agora = new Date(), opts: { semanal?: boolean } = {},
): Promise<Resumo> {
  const { itens, restantes } = selecionarParaResumo(await sinaisAbertos(sb, empresaId), agora)
  const semana = opts.semanal && ehSegunda(agora) ? await semanaQuePassou(sb, empresaId, agora) : null
  const cabecalho = semana ? `${saudacao(agora, nome)}\n\n${semana}` : saudacao(agora, nome)
  if (itens.length === 0) {
    return { texto: `${cabecalho}\n\n${SEM_NOVIDADE}`, geradoPor: 'modelo', itens, restantes: 0 }
  }
  const daIA = await corpoPelaIA(itens)
  return {
    texto: montarMensagem(cabecalho, daIA ?? corpoModelo(itens), restantes, LINK_CENTRAL),
    geradoPor: daIA ? 'ia' : 'modelo',
    itens, restantes,
  }
}

export type ResultadoEnvio = { ok: boolean; enviados: number; falhas: { numero: string; erro: string }[]; texto: string; semNovidade: boolean }

/**
 * Entrega um texto a cada destinatário (a saudação leva o nome de cada um,
 * pelo marcador {{NOME}}), registra em getulio_mensagens e marca os sinais
 * como avisados. A ORDEM de `sinais` é a da mensagem — é por ela que
 * "não me avise do item 2" acha o sinal certo.
 */
async function entregar(
  sb: any, empresaId: string, destinatarios: Destinatario[], textoBase: string,
  tipo: 'resumo_diario' | 'envio_manual' | 'alerta', geradoPor: string, sinais: string[], agora: Date,
): Promise<{ ok: boolean; enviados: number; falhas: { numero: string; erro: string }[]; texto: string }> {
  const validos = destinatarios.filter(d => String(d.numero ?? '').replace(/\D/g, '').length >= 10)
  if (validos.length === 0) return { ok: false, enviados: 0, falhas: [{ numero: '', erro: 'Nenhum número de WhatsApp cadastrado para o Getúlio' }], texto: '' }

  const falhas: { numero: string; erro: string }[] = []
  let enviados = 0
  for (const d of validos) {
    const texto = textoBase.replace(', {{NOME}}', d.nome?.trim() ? `, ${d.nome.trim()}` : '')
    const r = await enviarWhatsappAutomacao(sb, empresaId, String(d.numero).replace(/\D/g, ''), texto, {
      tipo: 'getulio', referencia_tipo: 'getulio',
    })
    if (r.ok) enviados++
    else falhas.push({ numero: d.numero, erro: r.erro ?? 'falha ao enviar' })
  }

  const texto = textoBase.replace(', {{NOME}}', '')
  const status = enviados === 0 ? 'erro' : falhas.length ? 'parcial' : 'enviado'
  await sb.from('getulio_mensagens').insert({
    empresa_id: empresaId, tipo, texto, gerado_por: geradoPor, sinais, destinatarios: validos, status,
    erro: falhas.length ? falhas.map(f => `${f.numero}: ${f.erro}`).join(' · ') : null,
  })
  if (enviados > 0 && sinais.length) {
    await sb.from('getulio_sinais').update({ avisado_em: agora.toISOString() }).in('id', sinais)
  }
  return { ok: enviados > 0, enviados, falhas, texto }
}

/**
 * Monta e envia o resumo. Dia sem novidade também envia, em uma linha:
 * silêncio por dias seguidos pareceria que o Getúlio parou de trabalhar.
 * Na segunda-feira (com `semanal`), abre com a semana que passou.
 */
export async function enviarResumo(
  sb: any, empresaId: string, destinatarios: Destinatario[], tipo: 'resumo_diario' | 'envio_manual',
  agora = new Date(), opts: { semanal?: boolean } = {},
): Promise<ResultadoEnvio> {
  const base = await montarResumo(sb, empresaId, '{{NOME}}', agora, opts)
  const r = await entregar(sb, empresaId, destinatarios, base.texto, tipo, base.geradoPor, base.itens.map(s => s.id), agora)
  if (r.ok && tipo === 'resumo_diario') {
    await sb.from('getulio_config').update({ ultimo_resumo_dia: diaISO(agora), updated_at: agora.toISOString() }).eq('empresa_id', empresaId)
  }
  return { ...r, semNovidade: base.itens.length === 0 }
}

/**
 * Alertas imediatos: o urgente que virou novidade agora e não pode esperar o
 * resumo de amanhã (ver selecionarAlertas). Um WhatsApp por alerta.
 */
export async function enviarAlertas(
  sb: any, empresaId: string, destinatarios: Destinatario[], agora = new Date(),
): Promise<{ enviados: number }> {
  const { count } = await sb.from('getulio_mensagens')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).eq('tipo', 'alerta').gte('created_at', inicioDoDia(agora).toISOString())
  const alertas = selecionarAlertas(await sinaisAbertos(sb, empresaId), agora, count ?? 0)
  let enviados = 0
  for (const s of alertas) {
    const link = s.link ? urlDoApp(s.link) : LINK_CENTRAL
    const r = await entregar(sb, empresaId, destinatarios, textoAlerta(s, link), 'alerta', 'modelo', [s.id], agora)
    if (r.ok) enviados++
  }
  return { enviados }
}
