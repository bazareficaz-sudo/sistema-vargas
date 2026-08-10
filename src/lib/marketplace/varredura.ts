// Fase 1 — varredura diária de anúncios (marketplace → sistema).
//
// Duas coisas que precisam ser verdade e não eram:
//
// 1. UMA passagem completa por dia não cabe numa invocação. O teto da Vercel
//    é 300s e são ~8.700 anúncios. Então a passagem é dividida: o cron roda
//    a cada 20 minutos, cada rodada anda o quanto der dentro do orçamento de
//    tempo, salva onde parou e devolve o controle. Quando termina o catálogo
//    inteiro, para de fazer qualquer coisa até a próxima janela diária.
//
// 2. Uma rodada que morre tem que deixar rastro. O log era gravado só no fim
//    — quando o cron estourava o tempo, morria antes de escrever, e a tela
//    ficava sem nenhum registro. Agora o log nasce no começo, com status
//    'executando', e é atualizado no fim. Rodada com 'executando' velho é
//    exatamente uma que morreu no meio.

export type AcaoVarredura = 'iniciar' | 'continuar' | 'nada'

// Sobra sobre o maxDuration=300 da rota. 60s de folga cobrem o encerramento
// (gravar cursor, fechar log) e a chamada de API que já estava em voo quando
// o orçamento acabou.
export const ORCAMENTO_MS = 240_000

// Quantas vezes uma passagem pode falhar e ainda ser retomada no mesmo dia.
// Existe para os dois extremos: sem retentativa, uma instabilidade de 30
// segundos na API custaria o dia inteiro de atualização; sem limite, um canal
// com token vencido geraria 72 erros por dia e a tela viraria ruído.
export const MAX_TENTATIVAS = 5

export type CanalVarredura = {
  varredura_status: string | null
  varredura_iniciada_em: string | null
  varredura_cursor: any
  varredura_rodadas?: number | null
}

/**
 * Decide o que fazer com um canal nesta rodada.
 *
 * A janela diária é fixa (03:00 no fuso da operação). Uma passagem começa na
 * primeira rodada depois das 03:00 que ainda não tenha passagem iniciada
 * hoje; as rodadas seguintes só continuam a que já está em andamento. Assim o
 * horário de início não escorrega dia após dia, que é o que aconteceria se a
 * regra fosse "começar quando a última terminou há mais de 24h".
 */
export function decidirAcao(
  canal: CanalVarredura,
  agora: Date,
  horaJanela = 3,
  fusoOffsetHoras = -3,
): AcaoVarredura {
  if (canal.varredura_status === 'em_andamento') return 'continuar'

  // Momento da última janela que já abriu, em UTC.
  const local = new Date(agora.getTime() + fusoOffsetHoras * 3600_000)
  const janela = new Date(Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), horaJanela, 0, 0,
  ))
  const janelaUtc = new Date(janela.getTime() - fusoOffsetHoras * 3600_000)
  const ultimaJanela = janelaUtc <= agora
    ? janelaUtc
    : new Date(janelaUtc.getTime() - 24 * 3600_000)

  const iniciada = canal.varredura_iniciada_em ? new Date(canal.varredura_iniciada_em) : null
  if (!iniciada || iniciada < ultimaJanela) return 'iniciar'

  // Passagem de hoje que falhou: retoma do cursor salvo, até o limite de
  // tentativas. O cursor é preservado no erro justamente para a retomada não
  // recomeçar do zero e gastar o dia relendo o que já leu.
  if (canal.varredura_status === 'erro' && (canal.varredura_rodadas ?? 0) < MAX_TENTATIVAS) {
    return 'continuar'
  }

  return 'nada'
}

/** Prazo desta rodada. Passar disso, para e salva onde parou. */
export function prazoDaRodada(inicio = Date.now(), orcamentoMs = ORCAMENTO_MS) {
  return inicio + orcamentoMs
}

/**
 * Abre o log ANTES do trabalho. O id devolvido serve para fechar depois — se
 * nunca for fechado, a linha com status 'executando' é a prova de que a
 * rodada morreu no meio.
 */
export async function abrirLog(sb: any, canalId: string, mensagem: string): Promise<string | null> {
  const { data } = await sb.from('marketplace_sync_log')
    .insert({ canal_id: canalId, tipo: 'varredura', status: 'executando', mensagem })
    .select('id').single()
  return data?.id ?? null
}

export async function fecharLog(
  sb: any, logId: string | null,
  status: 'ok' | 'erro', mensagem: string, detalhes?: any,
) {
  if (!logId) return
  await sb.from('marketplace_sync_log')
    .update({ status, mensagem, detalhes: detalhes ?? null }).eq('id', logId)
}

/**
 * Recupera rodadas que morreram no meio (a função foi encerrada antes de
 * fechar o log e de salvar o cursor).
 *
 * O sinal é preciso: um log 'executando' mais velho que o tempo máximo de vida
 * da função só pode ser de uma invocação que não existe mais. Uma rodada
 * saudável, ainda em execução, nunca passa disso — o teto da Vercel é 300s.
 *
 * Não basta fechar o log: o canal também fica preso em 'em_andamento', e
 * `decidirAcao` devolveria 'continuar' para sempre. Pior, como o cursor não
 * chegou a ser salvo, cada rodada refaria exatamente o mesmo pedaço, sem
 * nunca avançar. Marcar 'erro' e contar a tentativa devolve esse caso ao
 * limite de tentativas do dia, em vez de deixá-lo girar em falso.
 */
export async function recuperarRodadasMortas(sb: any, limiteMinutos = 10) {
  const corte = new Date(Date.now() - limiteMinutos * 60_000).toISOString()

  const { data: mortas } = await sb.from('marketplace_sync_log')
    .select('id, canal_id')
    .eq('tipo', 'varredura').eq('status', 'executando').lt('created_at', corte)

  if (!mortas?.length) return

  await sb.from('marketplace_sync_log')
    .update({ status: 'erro', mensagem: '[varredura] Rodada interrompida (provável estouro de tempo da função)' })
    .in('id', mortas.map((m: any) => m.id))

  for (const canalId of [...new Set(mortas.map((m: any) => m.canal_id))]) {
    const { data: canal } = await sb.from('marketplace_canais')
      .select('varredura_rodadas, varredura_status').eq('id', canalId).single()
    if (canal?.varredura_status !== 'em_andamento') continue
    await sb.from('marketplace_canais').update({
      varredura_status: 'erro',
      varredura_erro: 'Rodada interrompida antes de salvar o progresso',
      varredura_rodadas: (canal.varredura_rodadas ?? 0) + 1,
      varredura_ultimo_em: new Date().toISOString(),
    }).eq('id', canalId)
  }
}
