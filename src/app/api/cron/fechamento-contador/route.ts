import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mesAnterior } from '@/lib/fiscal/fechamento'
import { deveEnviarAutomatico, enviarFechamento, hojeEmBrasilia } from '@/lib/fiscal/enviarFechamento'

// Envio automático do fechamento ao contador (vercel.json: todo dia às 08h05
// de Brasília). Para cada empresa com o automático ligado, a partir do dia
// configurado, manda o fechamento do mês ANTERIOR — uma vez: se o mês já
// saiu (pelo botão ou por aqui), não manda de novo; se falhou, tenta outra
// vez no dia seguinte.
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const agora = new Date()
  const { dia } = hojeEmBrasilia(agora)
  const mes = mesAnterior(agora)
  const hojeISO = agora.toISOString().slice(0, 10)

  const { data: configs } = await sb.from('fechamento_contador_config')
    .select('empresa_id, dia_envio').eq('envio_automatico', true)

  const resultados: Record<string, unknown>[] = []
  for (const c of (configs ?? []) as { empresa_id: string; dia_envio: number }[]) {
    const { data: envios } = await sb.from('fechamento_contador_envios')
      .select('status, origem, created_at').eq('empresa_id', c.empresa_id).eq('mes', mes)
    if (!deveEnviarAutomatico({ diaHoje: dia, diaEnvio: c.dia_envio, envios: envios ?? [], hojeISO })) {
      resultados.push({ empresa: c.empresa_id, pulou: true })
      continue
    }
    // Sem usuário aqui: as vendas são procuradas nas empresas que apontam
    // esta como emitente (empresa_config_fiscal), que já são do mesmo grupo.
    const r = await enviarFechamento(sb, c.empresa_id, mes, { origem: 'automatico' })
    resultados.push({ empresa: c.empresa_id, mes, ...r })
  }

  return NextResponse.json({ ok: true, mes, resultados })
}
