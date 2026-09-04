import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { processarFilaDaEmpresa, type ConfigFila } from '@/lib/marketplace/fila'

// RODAR A FILA AGORA, a pedido de quem está olhando a tela.
//
// A mesma rodada do cron, sem esperar os 5 minutos dele nem o `intervalo_min`
// da empresa. Existe porque diagnosticar "por que este anúncio não subiu" com
// uma espera de 5 a 15 minutos entre tentativas é o que faz alguém desistir
// de diagnosticar.
//
// NÃO É UM MODO ESPECIAL. Chama `processarFilaDaEmpresa` exatamente como o
// cron chama, com a configuração gravada da empresa — simulação inclusive. Um
// botão que enviasse "de verdade" enquanto a empresa está em simulação seria
// um segundo caminho para produção, e o valor desta fila é ter só um.

export const maxDuration = 300

export async function POST() {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_marketplaces')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const { data: cfg } = await sb
    .from('marketplace_fila_config')
    .select('empresa_id, ativo, simulacao, intervalo_min, max_produtos_rodada, estoque_urgente, ultima_execucao')
    .eq('empresa_id', guarda.empresaId)
    .maybeSingle()

  if (!cfg) return NextResponse.json({ ok: false, erro: 'A fila ainda não foi configurada para esta empresa.' }, { status: 400 })
  if (!cfg.ativo) return NextResponse.json({ ok: false, erro: 'A fila está desligada. Ligue em "Fila ligada" antes de rodar.' }, { status: 400 })

  try {
    // `ultima_execucao: null` faz `devidoExecutar` liberar esta rodada. O
    // intervalo continua valendo para o cron; o que se dispensa aqui é a
    // espera, não a configuração — ela é regravada ao fim da rodada.
    const resultado = await processarFilaDaEmpresa(sb, { ...cfg, ultima_execucao: null } as ConfigFila)
    return NextResponse.json({ ok: true, resultado })
  } catch (e: unknown) {
    const erro = e instanceof Error ? e.message : 'Erro ao processar a fila'
    // O mesmo registro que o cron faz. Uma rodada manual que falha em
    // silêncio seria pior que não ter o botão.
    await sb.from('marketplace_sync_log').insert({
      canal_id: null, tipo: 'fila', status: 'erro',
      mensagem: `[fila manual] ${erro}`, detalhes: { error: erro, empresaId: guarda.empresaId },
    })
    return NextResponse.json({ ok: false, erro }, { status: 500 })
  }
}
