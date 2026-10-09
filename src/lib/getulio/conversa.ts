// CONVERSA COM O GETÚLIO PELO WHATSAPP (Fase 3 — perguntas).
//
// O dono pergunta ("quanto vendi ontem?", "detalha o item 2", "tem plug
// roscável?") e o Getúlio responde consultando o banco pelo catálogo fechado
// de consultas — nunca SQL livre, nunca número de cabeça.
//
// QUEM PODE CONVERSAR: só os números cadastrados como destinatários na
// Central, e só com "Responder perguntas pelo WhatsApp" ligado. Mensagem de
// cliente ou de número desconhecido não chega aqui — segue o caminho normal
// do atendimento.
//
// SÓ PERGUNTAS, por enquanto. Pedido de ação ("pausa o anúncio") é
// respondido com o caminho na tela; agir pelo WhatsApp é a etapa seguinte,
// e vai exigir confirmação.

import { perguntarComConsultas } from '@/lib/ia/comConsultas'
import { CONSULTAS_ESTOQUE } from '@/lib/ia/consultas/estoque'
import { registrarConsumoIA } from '@/lib/ia/gateway'
import { enviarWhatsappAutomacao } from '@/lib/automacoes/whatsapp-send'
import { diaISO } from '@/lib/datas'
import { CONSULTAS_GETULIO } from './consultas'
import { ACOES_APRENDER } from './aprender'
import { LINK_CENTRAL } from './resumo'
import type { Destinatario } from './tipos'
import { destinatarioDoNumero } from './numero'

export { mesmoNumero, destinatarioDoNumero } from './numero'

const MODELO = 'claude-haiku-4-5-20251001'
/** Respostas por hora por empresa — trava contra laço e abuso. */
export const LIMITE_POR_HORA = 30
const MAX_PERGUNTA = 600
const HISTORICO = 6

/** A empresa está pronta para conversar com este número? */
export async function getulioAtendeNumero(sb: any, empresaId: string, numero: string): Promise<Destinatario | null> {
  const { data: cfg } = await sb.from('getulio_config')
    .select('responder_whatsapp, destinatarios').eq('empresa_id', empresaId).maybeSingle()
  if (!cfg?.responder_whatsapp) return null
  return destinatarioDoNumero((cfg.destinatarios ?? []) as Destinatario[], numero)
}

export function montarPrompt(params: {
  nome: string; pergunta: string; hoje: string; diaSemana: string
  historico: { papel: string; texto: string }[]; ultimoResumo: string | null
}): string {
  return [
    `Você é o Getúlio, o assistente de gestão de uma loja de ferragens e utilidades que vende no balcão (PDV) e em marketplaces (Mercado Livre, Shopee, TikTok Shop, loja online). Está conversando pelo WhatsApp com ${params.nome || 'o dono'}, que administra o negócio.`,
    `Hoje é ${params.diaSemana}, ${params.hoje} (horário de Brasília).`,
    '',
    'COMO RESPONDER:',
    '- Use as ferramentas para buscar os números. NUNCA invente valores, produtos, datas ou causas. Sem dado, diga que não encontrou.',
    '- Converta datas relativas para AAAA-MM-DD antes de chamar a ferramenta. "Essa semana" = de segunda a domingo da semana atual; "no mês" = do dia 1º do mês até hoje; "mês passado" = o mês anterior inteiro. Ao responder, nomeie o período pelo que ele é (não chame o mês de "semana").',
    '- Dia da semana: use o que vier nos dados; nunca deduza por conta própria.',
    '- Para "quanto vendi" (a loja), use vendas_por_canal (soma balcão e marketplaces). Quando a pergunta é sobre um PRODUTO ("quanto vendeu" logo depois de falar dele), use vendas_de_um_produto_todos_canais com o SKU — não o total da loja. As consultas de estoque olham o saldo atual.',
    '- PRODUTO: chame primeiro buscar_produto com as palavras do dono do jeito que ele falou ("disjuntor 32a mono guepar") — ela entende abreviação, plural e equivalentes. Nas outras consultas, use o SKU que ela devolver. Se só vierem "parecidos", ofereça-os como opções ("não achei exatamente; tenho X e Y"). Nunca peça o nome exato ou o SKU antes de tentar.',
    '- CONTAS: nunca diga que está "em dia" sem conferir as vencidas (contas_a_pagar com incluir_vencidas=true). Se houver vencidas, mencione.',
    '- "Item N", "o segundo", "detalha" se referem ao último resumo abaixo; use avisos_do_getulio para o detalhe atualizado.',
    '- Diga o período coberto ("ontem, 06/10") e as ressalvas que mudam a leitura.',
    '- Tom de sócio experiente: direto, cordial, sem bajulação. Português do Brasil.',
    '- Formatação de WhatsApp: só *negrito* e listas curtas com "•". Sem títulos, tabelas ou markdown.',
    '- No máximo 700 caracteres. Valores em reais no formato R$ 1.234,56.',
    '- RESPONDA AGORA, NESTA MENSAGEM. Você não consegue "voltar depois": nunca escreva "vou buscar", "deixa eu ver" ou "depois confirmo". Busque com as ferramentas e já responda com o resultado; se nenhuma ferramenta cobre a pergunta, diga isso claramente e o que você consegue responder.',
    '- Cruzamentos de anúncios (marca + canal + zerado/pausado/ativo) se fazem com anuncios_filtrados, numa chamada só. Se "zerado" for ambíguo, use "qualquer_zerado" e separe na resposta o que está zerado no anúncio do que está zerado no sistema.',
    '- APRENDER: quando o dono disser "não me avise mais disso", "isso não interessa" ou mandar 👎 sobre um aviso, use parar_de_avisar com o número do item (se a última mensagem foi um alerta, item 1). Se ele rejeitar um TIPO inteiro ("não quero mais aviso de estoque negativo"), use desligar_tipo_de_aviso; para voltar, religar_tipo_de_aviso. Confirme em uma linha o que fez. 👍 sozinho é só um agradecimento: responda curto.',
    `- Fora isso, você AINDA NÃO executa ações no negócio (pausar, mudar preço, pagar, enviar). Se pedirem, diga que por enquanto você só consulta e que isso se faz no sistema; ofereça a consulta que ajuda (ex.: listar os itens). NÃO descreva telas, menus, seções ou botões — você não os conhece. Link geral, se útil: ${LINK_CENTRAL}.`,
    '- Não cite empresas de tecnologia nem ferramentas internas.',
    '- FOTO DE PRODUTO: se perguntarem como pôr foto, explique que é só mandar a foto aqui no WhatsApp com o SKU (ou o nome do produto) na legenda, que você coloca no cadastro.',
    '',
    params.ultimoResumo ? `ÚLTIMA MENSAGEM QUE VOCÊ MANDOU (resumo ou alerta):\n${params.ultimoResumo}\n` : '',
    params.historico.length ? `CONVERSA RECENTE:\n${params.historico.map(h => `${h.papel === 'dono' ? 'Dono' : 'Getúlio'}: ${h.texto}`).join('\n')}\n` : '',
    `MENSAGEM AGORA: ${JSON.stringify(params.pergunta)}`,
    '',
    'Responda SOMENTE com JSON: {"resposta": "texto da mensagem de WhatsApp"}',
  ].join('\n')
}

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

/**
 * Responde a uma mensagem do dono. Chamado pelo webhook do WhatsApp DEPOIS
 * de devolver 200 (after), então pode demorar o que a consulta precisar.
 */
export async function responderMensagem(sb: any, empresaId: string, numero: string, destinatario: Destinatario, textoBruto: string): Promise<void> {
  const pergunta = String(textoBruto ?? '').trim().slice(0, MAX_PERGUNTA)
  if (!pergunta) return
  const numeroLimpo = String(numero).replace(/\D/g, '')

  // Histórico ANTES de gravar a pergunta atual.
  const { data: anteriores } = await sb.from('getulio_conversas')
    .select('papel, texto, created_at').eq('empresa_id', empresaId).eq('numero', numeroLimpo)
    .gte('created_at', new Date(Date.now() - 6 * 3_600_000).toISOString())
    .order('created_at', { ascending: false }).limit(HISTORICO)
  await sb.from('getulio_conversas').insert({ empresa_id: empresaId, numero: numeroLimpo, papel: 'dono', texto: pergunta })

  const enviar = async (texto: string, extra: { consultas?: string[]; erro?: string } = {}) => {
    await enviarWhatsappAutomacao(sb, empresaId, numeroLimpo, texto, { tipo: 'getulio_resposta', referencia_tipo: 'getulio' })
    await sb.from('getulio_conversas').insert({
      empresa_id: empresaId, numero: numeroLimpo, papel: 'getulio', texto,
      consultas: extra.consultas ?? [], erro: extra.erro ?? null,
    })
  }

  const { count } = await sb.from('getulio_conversas')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).eq('papel', 'getulio')
    .gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
  if ((count ?? 0) >= LIMITE_POR_HORA) {
    // Nem responde que estourou a cada mensagem: uma vez basta.
    if ((count ?? 0) === LIMITE_POR_HORA) await enviar('Recebi muitas perguntas na última hora — dou uma pausa e volto a responder daqui a pouco. Enquanto isso, está tudo na Central: ' + LINK_CENTRAL)
    return
  }

  const { data: resumo } = await sb.from('getulio_mensagens')
    .select('texto, created_at').eq('empresa_id', empresaId).in('status', ['enviado', 'parcial'])
    .gte('created_at', new Date(Date.now() - 36 * 3_600_000).toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  const agora = new Date()
  const prompt = montarPrompt({
    nome: destinatario.nome, pergunta,
    hoje: diaISO(agora).split('-').reverse().join('/'),
    diaSemana: DIAS[new Date(agora.getTime() - 3 * 3_600_000).getUTCDay()],
    historico: [...(anteriores ?? [])].reverse(),
    ultimoResumo: resumo?.texto ?? null,
  })

  try {
    const r = await perguntarComConsultas({
      sb, empresaId, prompt,
      // `estoque_de_um_produto` sai: ela procura a frase inteira no nome e
      // devolvia "não encontrei" para "disjuntor 32a mono guepar". Quem acha
      // produto aqui é buscar_produto.
      consultas: [...CONSULTAS_GETULIO, ...ACOES_APRENDER, ...CONSULTAS_ESTOQUE.filter(c => c.nome !== 'estoque_de_um_produto')],
      modelo: MODELO, maxTokens: 1200,
    })
    if (!r.ok) throw new Error(r.motivo)
    const resposta = typeof (r.valor as any)?.resposta === 'string' ? (r.valor as any).resposta.trim() : ''
    if (!resposta) throw new Error('resposta vazia')
    await enviar(resposta.slice(0, 1500), { consultas: r.consultasUsadas })
    await registrarConsumoIA(sb, {
      empresa_id: empresaId, usuario_id: null, funcionalidade: 'getulio_whatsapp', provedor: 'anthropic',
      modelo: MODELO, status: 'sucesso', tokens_entrada: r.tokensEntrada, tokens_saida: r.tokensSaida,
    }).catch(() => {})
  } catch (e: any) {
    await enviar(
      'Não consegui buscar isso agora — tente perguntar de outro jeito daqui a pouco. Os assuntos do dia estão na Central: ' + LINK_CENTRAL,
      { erro: e?.message ?? String(e) },
    )
  }
}
