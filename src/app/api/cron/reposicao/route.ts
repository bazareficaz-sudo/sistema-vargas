import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recalcularEmpresa, type ResumoRodada } from '@/lib/reposicao/recalcular'

// Recalcula as métricas de reposição de todas as empresas.
//
// Uma vez por dia, de madrugada (ver vercel.json). O cálculo lê o catálogo
// inteiro e 180 dias de venda — é justamente o que não pode acontecer
// quando o comprador abre a tela.
//
// Cada empresa é isolada: uma que falhe não impede as outras de calcular.
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const { data: empresas } = await sb.from('empresas').select('id, nome')

  const resultados: (ResumoRodada | { empresaId: string; erro: string })[] = []
  for (const e of empresas ?? []) {
    try {
      resultados.push(await recalcularEmpresa(sb, e.id))
    } catch (err) {
      resultados.push({ empresaId: e.id, erro: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, empresas: resultados })
}
