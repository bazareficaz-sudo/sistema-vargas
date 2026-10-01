import { enviarWhatsappAutomacao } from './whatsapp-send'

// Throttle: enquanto o problema persistir, o cron roda a cada 5min e a
// regra terminaria 'erro' de novo toda vez — sem isto, o operador recebia
// o mesmo aviso centenas de vezes ao dia.
const JANELA_THROTTLE_MS = 60 * 60 * 1000 // 1h
const REFERENCIA_TIPO = 'automacao_falha'

/**
 * Avisa por WhatsApp quando uma automação termina com status 'erro' — só
 * se a regra tiver `alertar_erro_whatsapp` preenchido (opt-in, por regra).
 * Dedup via whatsapp_mensagens (mesmo idioma de src/lib/alertas/pedidoCliente.ts),
 * não uma tabela nova.
 */
export async function avisarFalhaSeConfigurado(sb: any, a: any, mensagemErro: string | undefined) {
  if (!a.alertar_erro_whatsapp) return
  try {
    const { data: ultimoAviso } = await sb.from('whatsapp_mensagens')
      .select('created_at')
      .eq('referencia_tipo', REFERENCIA_TIPO).eq('referencia_id', a.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (ultimoAviso && Date.now() - new Date(ultimoAviso.created_at).getTime() < JANELA_THROTTLE_MS) return

    await enviarWhatsappAutomacao(
      sb, a.empresa_id, a.alertar_erro_whatsapp,
      `⚠️ Automação "${a.nome}" falhou: ${mensagemErro ?? 'erro desconhecido'}`,
      { tipo: 'falha_automacao', referencia_tipo: REFERENCIA_TIPO, referencia_id: a.id },
    )
  } catch {
    // Falhar em avisar não pode derrubar o executor — a automação em si já
    // registrou o erro em ultimo_erro, que é a fonte de verdade.
  }
}
