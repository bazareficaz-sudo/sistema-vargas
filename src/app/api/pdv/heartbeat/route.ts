import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autenticarTerminalPdv, respostaDeRecusa } from '@/lib/pdv/autenticarTerminal'
import { INTERVALO_HEARTBEAT_MS } from '@/lib/pdv/saudeTerminal'

// HEARTBEAT — "estou vivo agora".
//
// Responsabilidade separada da do token de propósito. O JWT responde *quem é
// você*; o heartbeat responde *você está aí*. Misturar as duas foi o erro da
// 0.6A: eu tratei a renovação do token como sinal de vida, e ela não é —
// `obterToken` devolve o token de memória sem falar com o servidor enquanto
// ele valer, então um terminal ficava 11h30 mudo por desenho.
//
// ── O QUE ESTA ROTA NÃO FAZ ──────────────────────────────────────────────
//
// Não emite token. Não renova token. Não lê tabela de negócio. Não escreve
// linha nova. Não exige a flag de rollout — um terminal ativado deve poder
// dizer que está vivo mesmo sem ter sido escolhido para a rota nova, senão o
// painel fica cego justamente sobre quem ainda não migrou.
//
// ── CUSTO ────────────────────────────────────────────────────────────────
//
// Uma batida a cada 5 min, com 6 a 10 terminais, dá 72 a 120 requisições por
// hora. Cada uma custa duas leituras e duas escritas numa tabela de 6 linhas.
// É barato e previsível; o que encarece um heartbeat é ele carregar carona,
// e este não carrega.

export async function POST(req: Request) {
  const corpo = await req.json().catch(() => ({}))

  // `exigirFlag: false` — ver acima. Saúde vale para todo terminal ativo.
  const acesso = await autenticarTerminalPdv(req, { exigirFlag: false })
  if (!acesso.ok) return respostaDeRecusa(acesso)

  const ctx = acesso.contexto
  const agora = new Date().toISOString()
  const versao = corpo?.versao_pdv ? String(corpo.versao_pdv).slice(0, 40) : null

  const sb = createAdminClient()
  await sb.from('pdv_terminais').update({
    ultimo_heartbeat_em: agora,
    // A versão vem em toda batida porque é assim que uma atualização aparece
    // no painel sem ninguém precisar avisar.
    ...(versao ? { versao_pdv: versao } : {}),
  }).eq('id', ctx.terminal_id)

  return NextResponse.json({
    ok: true,
    terminal: ctx.nome,
    // O PDV usa isto para se ajustar se um dia mudarmos o intervalo, sem
    // precisar de release nova.
    intervalo_ms: INTERVALO_HEARTBEAT_MS,
  })
}
