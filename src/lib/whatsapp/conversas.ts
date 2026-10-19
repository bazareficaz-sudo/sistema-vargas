import { precoVigente, promocaoVigente, type ProdutoComPromocao } from '@/lib/produtos/promocao'
import { aplicarModelo } from '@/lib/mensagens/modelo'

// Caixa de entrada do WhatsApp: regras de exibição das conversas (sem banco).

/** Mensagem do cliente fica à esquerda; tudo que a loja mandou, à direita. */
export const doCliente = (tipo: string) => tipo === 'recebida'

const ROTULO: Record<string, string> = {
  atendimento: 'Atendimento', enviada_celular: 'Pelo celular', manual: 'Manual',
  orcamento: 'Orçamento', cupom: 'Cupom', comprovante_venda: 'Comprovante', cobranca: 'Cobrança',
  catalogo: 'Catálogo', produto_individual: 'Produto', confirmacao_pag: 'Confirmação de pagamento',
  lembrete_venc: 'Lembrete', pos_venda: 'Pós-venda', automacao_alerta_pedido: 'Aviso de pedido',
  automacao_whatsapp_aviso_falta_chegou: 'Aviso: chegou',
  automacao_fora_horario: 'Fora do horário (automática)',
  envio_categoria: 'Envio por categoria',
}
/** Rótulo do que a loja mandou (nada para conversa comum). */
export function rotuloSaida(tipo: string): string | null {
  if (tipo === 'recebida' || tipo === 'atendimento') return null
  return ROTULO[tipo] ?? (tipo.startsWith('automacao_') ? 'Automação' : tipo)
}

/** "agora", "12 min", "3 h", "2 dias" desde a última mensagem sem resposta. */
export function tempoDeEspera(desde: string | Date, agora: Date = new Date()): string {
  const min = Math.max(0, Math.floor((agora.getTime() - new Date(desde).getTime()) / 60_000))
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return `${d} dia${d === 1 ? '' : 's'}`
}

// ── Parte B: produto, respostas rápidas ───────────────────────────────────

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ')
const diaMes = (s: string) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) }

export type ProdutoParaEnviar = ProdutoComPromocao & { nome: string; sku?: string | number | null; unidade?: string | null }

/**
 * Legenda da foto do produto na conversa. Preço pela regra única do sistema
 * (promoção só quando vigente, com o "de/por" e a validade); nunca custo.
 * Sem preço de venda cadastrado, vai só o nome — melhor do que "R$ 0,00".
 */
export function legendaDoProduto(p: ProdutoParaEnviar, agora: Date = new Date()): string {
  const linhas = [`*${p.nome.trim()}*`]
  const normal = Number(p.preco_venda ?? 0)
  const preco = precoVigente(p, agora)
  const un = p.unidade && p.unidade.toUpperCase() !== 'UN' ? ` / ${p.unidade}` : ''
  if (promocaoVigente(p, agora) && normal > preco) {
    const ate = p.promocao_fim ? diaMes(p.promocao_fim) : null
    linhas.push(`De ~${brl(normal)}~ por *${brl(preco)}*${un}${ate ? ` (promoção até ${ate})` : ''}`)
  } else if (preco > 0) {
    linhas.push(`*${brl(preco)}*${un}`)
  }
  if (p.sku) linhas.push(`Cód. ${p.sku}`)
  return linhas.join('\n')
}

export type RespostaRapida = { id?: string; nome: string; conteudo: string }

/**
 * Respostas prontas a partir do que a loja já cadastrou (horário do
 * WhatsApp, endereço da empresa). Só entra o que tem dado: nada de
 * "Endereço: undefined".
 */
export function respostasPadrao(dados: {
  horario?: string | null
  endereco?: { logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null } | null
}): RespostaRapida[] {
  const r: RespostaRapida[] = [{ nome: 'Saudação', conteudo: 'Olá{, nome}! Aqui é da {loja}. Como posso ajudar?' }]
  if (dados.horario?.trim()) r.push({ nome: 'Horário', conteudo: `Nosso horário de atendimento: ${dados.horario.trim()}` })
  const e = dados.endereco
  if (e?.logradouro?.trim()) {
    const rua = [e.logradouro.trim(), e.numero?.trim()].filter(Boolean).join(', ')
    const local = [e.bairro?.trim(), [e.cidade?.trim(), e.uf?.trim()].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
    r.push({ nome: 'Endereço', conteudo: `Estamos na ${rua}${local ? ` — ${local}` : ''}. Te esperamos!` })
  }
  r.push({ nome: 'Obrigado', conteudo: 'Obrigado pelo contato{, nome}! Qualquer dúvida, é só chamar.' })
  return r
}

/**
 * Preenche a resposta: {nome} (primeiro nome do cliente ou do WhatsApp),
 * {nome_cliente}, {loja}. "{, nome}" vira ", Maria" — ou some quando não há
 * nome, para não sair "Olá, !".
 */
export function preencherResposta(conteudo: string, dados: { nome?: string | null; loja?: string | null }): string {
  const primeiro = (dados.nome ?? '').trim().split(/\s+/)[0] ?? ''
  const nome = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : ''
  const base = conteudo.replace(/\{,\s*nome\}/gi, nome ? `, ${nome}` : '')
  return aplicarModelo(base, { nome, nome_cliente: nome, loja: dados.loja ?? '', nome_empresa: dados.loja ?? '' }).texto
    .replace(/\{(nome|nome_cliente|loja|nome_empresa)\}/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
}

// ── Etapa 3: etapas do atendimento e lembrete de retorno ─────────────────

export const ETAPAS = [
  { id: 'novo', rotulo: 'Novo', cor: 'bg-gray-100 text-gray-700' },
  { id: 'atendimento', rotulo: 'Em atendimento', cor: 'bg-blue-100 text-blue-700' },
  { id: 'orcamento', rotulo: 'Orçamento enviado', cor: 'bg-amber-100 text-amber-800' },
  { id: 'comprou', rotulo: 'Comprou', cor: 'bg-green-100 text-green-700' },
  { id: 'perdido', rotulo: 'Perdido', cor: 'bg-red-100 text-red-700' },
] as const
export type Etapa = (typeof ETAPAS)[number]['id']
export const etapaDe = (id: string | null | undefined) => ETAPAS.find(e => e.id === id) ?? ETAPAS[0]

/** Data de hoje (AAAA-MM-DD) no fuso da loja — o lembrete é por dia, não por hora. */
export function hojeNaLoja(agora: Date = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

/** Soma dias a uma data AAAA-MM-DD, sem depender do fuso de quem roda. */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Atalhos do lembrete: amanhã, em 3 dias e a próxima segunda-feira (nunca hoje). */
export function atalhosDeRetorno(agora: Date = new Date()): { rotulo: string; dia: string }[] {
  const hoje = hojeNaLoja(agora)
  const semana = new Date(`${hoje}T12:00:00Z`).getUTCDay() // 0 = domingo
  const ateSegunda = ((8 - semana) % 7) || 7
  return [
    { rotulo: 'Amanhã', dia: somarDias(hoje, 1) },
    { rotulo: 'Em 3 dias', dia: somarDias(hoje, 3) },
    { rotulo: 'Próx. segunda', dia: somarDias(hoje, ateSegunda) },
  ]
}

/** "hoje", "amanhã", "atrasado 2 dias" ou "dd/mm". */
export function rotuloRetorno(dia: string, agora: Date = new Date()): string {
  const hoje = hojeNaLoja(agora)
  const dif = Math.round((new Date(`${dia}T12:00:00Z`).getTime() - new Date(`${hoje}T12:00:00Z`).getTime()) / 864e5)
  if (dif === 0) return 'hoje'
  if (dif === 1) return 'amanhã'
  if (dif < 0) return `atrasado ${-dif} dia${dif === -1 ? '' : 's'}`
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}
