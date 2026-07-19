import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { executarAutomacoesPendentes } from '@/lib/automacoes/executor'

// Roda a cada 5 minutos (ver vercel.json). Avalia todas as automações
// ativas de todas as empresas — tipos agendados (1x/dia, dedup por
// ultima_execucao_dia) e tipos por evento (processam registros novos desde
// cursor_processado). Cada regra é isolada: uma falha não trava as demais.
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const resultado = await executarAutomacoesPendentes(sb)

  return NextResponse.json({ ok: true, ...resultado })
}
