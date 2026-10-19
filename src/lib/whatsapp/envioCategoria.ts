// Mensagem para uma categoria de clientes (envio assistido). O ritmo é do
// banco (supabase/migrations/20261020180000_whatsapp_envio_categoria.sql):
// estes números só explicam na tela o que ele já impõe.
import { preencherResposta } from './conversas'

export const LIMITE_POR_DIA = 30
export const INTERVALO_MINIMO_S = 45
export const HORARIO = { de: 8, ate: 20 }
/** No envio automático, espera entre um e outro (sorteada, para não parecer robô). */
export const ESPERA_AUTOMATICA_S = { min: 60, max: 120 }

export const RODAPE_SAIR = 'Para não receber mais mensagens como esta, responda SAIR.'

/** Texto que o cliente recebe: {nome} e {loja} preenchidos e o rodapé de saída. */
export function montarMensagem(modelo: string, nome: string | null | undefined, loja: string | null | undefined): string {
  return `${preencherResposta(modelo, { nome, loja }).trim()}\n\n${RODAPE_SAIR}`
}

const PALAVRAS_SAIR = new Set(['sair', 'parar', 'pare', 'stop', 'descadastrar', 'nao quero receber', 'nao quero mais receber', 'nao quero mais'])

/** O cliente respondeu pedindo para não receber mais? Só a mensagem inteira conta ("SAIR", "Parar."). */
export function pedeParaSair(texto: string | null | undefined): boolean {
  const t = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
  return PALAVRAS_SAIR.has(t)
}

export function esperaAutomatica(sorteio: number = Math.random()): number {
  const { min, max } = ESPERA_AUTOMATICA_S
  return Math.round(min + (max - min) * Math.min(1, Math.max(0, sorteio)))
}

export const SITUACAO_ITEM: Record<string, { rotulo: string; cor: string }> = {
  pendente: { rotulo: 'Na fila', cor: 'bg-gray-100 text-gray-600' },
  enviando: { rotulo: 'Enviando', cor: 'bg-blue-100 text-blue-700' },
  enviado: { rotulo: 'Enviado', cor: 'bg-emerald-100 text-emerald-700' },
  erro: { rotulo: 'Não enviado', cor: 'bg-red-100 text-red-700' },
  incerto: { rotulo: 'Sem confirmação', cor: 'bg-amber-100 text-amber-800' },
  pulado: { rotulo: 'Fora', cor: 'bg-gray-100 text-gray-400' },
}

/** Por que parou (resposta do banco), em português da tela. */
export function avisoDaSituacao(situacao: string, espera = 0): string {
  switch (situacao) {
    case 'aguarde': return `Aguardando ${espera} s para o próximo (mínimo de ${INTERVALO_MINIMO_S} s entre envios).`
    case 'limite': return `Limite de ${LIMITE_POR_DIA} mensagens por dia atingido. Continue amanhã.`
    case 'fora_horario': return `Envios só das ${HORARIO.de}h às ${HORARIO.ate}h.`
    case 'fim': return 'Fila concluída.'
    case 'parado': return 'Lote pausado ou cancelado.'
    default: return ''
  }
}

type Admin = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Cliente respondeu SAIR a uma mensagem de lote (últimos 30 dias): passa a
 * "não quer receber WhatsApp" (o mesmo campo do cadastro). Sem lote recente,
 * nada muda — "parar" solto pode ser outra conversa.
 */
export async function registrarPedidoDeSaida(admin: Admin, empresaId: string, clienteId: string, agora: Date = new Date()): Promise<boolean> {
  const desde = new Date(agora.getTime() - 30 * 86_400_000).toISOString()
  const { data } = await admin.from('whatsapp_lote_itens').select('id')
    .eq('empresa_id', empresaId).eq('cliente_id', clienteId).in('status', ['enviado', 'incerto']).gte('reservado_em', desde).limit(1)
  if (!data?.length) return false
  const { error } = await admin.from('clientes').update({ opt_out_whatsapp: true, updated_at: agora.toISOString() })
    .eq('id', clienteId).eq('empresa_id', empresaId)
  return !error
}
