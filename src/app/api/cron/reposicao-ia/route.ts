import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gerarSinaisIA, type ResumoIA } from '@/lib/reposicao/ia'

// Roda por último, depois de fornecedores (05:30) e reposição (06:00) —
// precisa que `reposicao_metricas` já esteja fresca antes de escolher os
// 40 produtos de maior score.
export const maxDuration = 120

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const { data: empresas } = await sb.from('empresas').select('id')

  const resultados: (ResumoIA | { empresaId: string; erro: string })[] = []
  for (const e of empresas ?? []) {
    try {
      resultados.push(await gerarSinaisIA(sb, e.id))
    } catch (err) {
      // Uma empresa sem ANTHROPIC_API_KEY configurada, ou a IA fora do ar,
      // não pode derrubar as outras nem travar a rodada da noite inteira.
      resultados.push({ empresaId: e.id, erro: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, empresas: resultados })
}
