import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function EntradasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id ?? ''

  const { data: entradas } = await supabase
    .from('entradas')
    .select('*, fornecedores(razao_social, nome_fantasia)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(100)

  function statusBadge(s: string) {
    if (s === 'confirmada') return 'bg-green-100 text-green-700'
    if (s === 'cancelada') return 'bg-red-100 text-red-600'
    return 'bg-yellow-100 text-yellow-700'
  }
  function statusLabel(s: string) {
    if (s === 'confirmada') return 'Confirmada'
    if (s === 'cancelada') return 'Cancelada'
    return 'Rascunho'
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>compras</span><span>›</span>
        <span className="text-gray-600 font-medium">entradas</span>
      </div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Entradas de Mercadoria</h1>
          <p className="text-gray-500 text-sm mt-0.5">{entradas?.length ?? 0} entradas</p>
        </div>
        <Link href="/dashboard/entradas/nova"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Nova entrada
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nº NF</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Fornecedor</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Data entrada</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Total</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(entradas ?? []).map((e: any) => (
              <tr key={e.id} className="hover:bg-gray-50 transition-colors group">
                <td className="px-4 py-3 font-mono text-gray-700 text-xs">{e.numero_nf ?? '—'}</td>
                <td className="px-4 py-3">
                  <p className="text-gray-900 font-medium">{e.fornecedores?.nome_fantasia ?? e.fornecedores?.razao_social ?? '—'}</p>
                  {e.fornecedores?.nome_fantasia && <p className="text-xs text-gray-400">{e.fornecedores.razao_social}</p>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {new Date(e.data_entrada).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">
                  {Number(e.valor_total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge(e.status)}`}>
                    {statusLabel(e.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/entradas/${e.id}`}
                    className="opacity-0 group-hover:opacity-100 text-xs text-blue-600 hover:text-blue-800 transition-opacity font-medium">
                    {e.status === 'rascunho' ? 'Continuar' : 'Editar'}
                  </Link>
                </td>
              </tr>
            ))}
            {(entradas ?? []).length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-gray-400">
                Nenhuma entrada registrada. <Link href="/dashboard/entradas/nova" className="text-blue-600 hover:underline">Criar primeira entrada</Link>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
