import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processarFilaDaEmpresa, type ConfigFila } from '@/lib/marketplace/fila'

// FASE 3 — roda a fila de atualização de anúncios (sistema → marketplace).
//
// Dispara a cada 5 minutos, mas quem manda no ritmo é o `intervalo_min` de
// cada empresa: a rodada só trabalha se o intervalo configurado já venceu.
// Assim o intervalo vira configuração de verdade, e não um agendamento fixo
// que só o programador consegue mudar.
//
// Com `simulacao` ligado — o padrão — nada é enviado: a rodada calcula e
// grava o que enviaria. Com ela desligada, envia de verdade, e só para os
// canais que têm "atualizar estoque do canal" ligado em Configurar → canal.

export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()

  const { data: configs, error } = await sb
    .from('marketplace_fila_config')
    .select('empresa_id, ativo, simulacao, intervalo_min, max_produtos_rodada, estoque_urgente, ultima_execucao')
    .eq('ativo', true)

  // Nunca tratar erro de consulta como "0 empresas" em silêncio.
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const resultados: any[] = []

  for (const cfg of (configs ?? []) as ConfigFila[]) {
    try {
      resultados.push(await processarFilaDaEmpresa(sb, cfg))
    } catch (e: any) {
      const erro = e?.message ?? 'Erro ao processar a fila'
      await sb.from('marketplace_sync_log').insert({
        canal_id: null, tipo: 'fila', status: 'erro',
        mensagem: `[fila] ${erro}`, detalhes: { error: erro, empresaId: cfg.empresa_id },
      })
      // Uma empresa que falha não derruba as outras.
      resultados.push({ empresaId: cfg.empresa_id, executou: false, motivo: erro })
    }
  }

  return NextResponse.json({
    ok: true,
    empresas: resultados.length,
    executaram: resultados.filter(r => r.executou).length,
    resultados,
  })
}
