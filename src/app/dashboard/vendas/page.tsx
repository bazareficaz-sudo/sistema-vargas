import { createClient } from '@/lib/supabase/server'

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; data?: string }>
}) {
  const { pagina = '1', data: dataFiltro } = await searchParams
  const pg = Math.max(1, parseInt(pagina))
  const POR_PAGINA = 50
  const offset = (pg - 1) * POR_PAGINA

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id

  const dataBase = dataFiltro ? new Date(dataFiltro) : new Date()
  dataBase.setHours(0, 0, 0, 0)
  const dataFim = new Date(dataBase)
  dataFim.setHours(23, 59, 59, 999)

  const { data: vendas, count } = await supabase
    .from('vendas')
    .select('id, numero, total, desconto, status, created_at, clientes(nome)', { count: 'exact' })
    .eq('empresa_id', empresaId)
    .gte('created_at', dataBase.toISOString())
    .lte('created_at', dataFim.toISOString())
    .order('created_at', { ascending: false })
    .range(offset, offset + POR_PAGINA - 1)

  const totalPaginas = Math.ceil((count ?? 0) / POR_PAGINA)
  const totalFaturado = (vendas ?? []).filter(v => v.status === 'concluida').reduce((s, v) => s + (v.total ?? 0), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-semibold">Vendas</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {count} transações · {totalFaturado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} faturados
          </p>
        </div>
        <form className="flex gap-2">
          <input
            type="date"
            name="data"
            defaultValue={dataFiltro ?? dataBase.toISOString().slice(0, 10)}
            className="bg-gray-900 border border-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors">
            Filtrar
          </button>
        </form>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left px-4 py-3 font-medium">#</th>
              <th className="text-left px-4 py-3 font-medium">Horário</th>
              <th className="text-left px-4 py-3 font-medium">Cliente</th>
              <th className="text-right px-4 py-3 font-medium">Desconto</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-center px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {(vendas ?? []).map(v => (
              <tr key={v.id} className="text-gray-300 hover:bg-gray-800/40 transition-colors">
                <td className="px-4 py-2.5 text-gray-500 font-mono">{v.numero}</td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">
                  {new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5 text-white">{(v.clientes as unknown as { nome: string } | null)?.nome ?? 'Consumidor'}</td>
                <td className="px-4 py-2.5 text-right text-gray-400">
                  {(v.desconto ?? 0) > 0
                    ? (v.desconto ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-white font-medium">
                  {(v.total ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    v.status === 'concluida' ? 'bg-green-500/20 text-green-400' :
                    v.status === 'cancelada' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>{v.status}</span>
                </td>
              </tr>
            ))}
            {(!vendas || vendas.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-600">
                  Nenhuma venda nesta data.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-gray-500 text-xs">Página {pg} de {totalPaginas}</p>
            <div className="flex gap-2">
              {pg > 1 && <a href={`?data=${dataFiltro}&pagina=${pg - 1}`} className="text-xs px-3 py-1.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700">← Anterior</a>}
              {pg < totalPaginas && <a href={`?data=${dataFiltro}&pagina=${pg + 1}`} className="text-xs px-3 py-1.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700">Próxima →</a>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
