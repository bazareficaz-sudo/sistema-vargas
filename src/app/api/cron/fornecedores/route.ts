import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recalcularFornecedorProduto, type ResumoFornecedores } from '@/lib/fornecedores/recalcular'

// Recalcula o histórico fornecedor×produto de todas as empresas.
//
// Roda antes do cron de reposição (ver vercel.json): o motor de reposição
// lê `fornecedor_produto` para resolver o lead time de cada produto, então
// o histórico precisa estar atualizado quando a reposição rodar.
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, erro: 'Não autorizado' }, { status: 401 })
  }

  const sb = createAdminClient()
  const { data: empresas } = await sb.from('empresas').select('id')

  const resultados: (ResumoFornecedores | { empresaId: string; erro: string })[] = []
  for (const e of empresas ?? []) {
    try {
      resultados.push(await recalcularFornecedorProduto(sb, e.id))
    } catch (err) {
      resultados.push({ empresaId: e.id, erro: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, empresas: resultados })
}
