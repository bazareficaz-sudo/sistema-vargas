import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>
}) {
  const { q = '', pagina = '1' } = await searchParams
  const pg = Math.max(1, parseInt(pagina))
  const POR_PAGINA = 50
  const offset = (pg - 1) * POR_PAGINA

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id

  let query = supabase
    .from('clientes')
    .select('id, nome, cpf_cnpj, telefone, cidade, estado, saldo_credito, saldo_devedor, status_credito, ativo', { count: 'exact' })
    .eq('empresa_id', empresaId)
    .order('nome')
    .range(offset, offset + POR_PAGINA - 1)

  if (q) query = query.ilike('nome', `%${q}%`)

  const { data: clientes, count } = await query
  const totalPaginas = Math.ceil((count ?? 0) / POR_PAGINA)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-semibold">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">{count?.toLocaleString('pt-BR')} clientes cadastrados</p>
        </div>
      </div>

      <form className="mb-4">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nome..."
          className="bg-gray-900 border border-gray-800 text-white rounded-lg px-4 py-2 text-sm w-72 focus:outline-none focus:border-blue-500 placeholder-gray-600"
        />
        <button type="submit" className="ml-2 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          Buscar
        </button>
      </form>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left px-4 py-3 font-medium">Nome</th>
              <th className="text-left px-4 py-3 font-medium">CPF/CNPJ</th>
              <th className="text-left px-4 py-3 font-medium">Telefone</th>
              <th className="text-left px-4 py-3 font-medium">Cidade</th>
              <th className="text-right px-4 py-3 font-medium">Crédito</th>
              <th className="text-right px-4 py-3 font-medium">Débito</th>
              <th className="text-center px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {(clientes ?? []).map(c => (
              <tr key={c.id} className="text-gray-300 hover:bg-gray-800/40 transition-colors">
                <td className="px-4 py-2.5 text-white font-medium">
                  <Link href={`/dashboard/clientes/${c.id}`} className="hover:text-blue-400 transition-colors">{c.nome}</Link>
                </td>
                <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{c.cpf_cnpj ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-400">{c.telefone ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-400">{c.cidade ? `${c.cidade}/${c.estado}` : '—'}</td>
                <td className="px-4 py-2.5 text-right text-green-400">
                  {(c.saldo_credito ?? 0) > 0
                    ? (c.saldo_credito ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-red-400">
                  {(c.saldo_devedor ?? 0) > 0
                    ? (c.saldo_devedor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    c.status_credito === 'liberado' ? 'bg-green-500/20 text-green-400' :
                    c.status_credito === 'bloqueado' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {c.status_credito ?? 'liberado'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-gray-500 text-xs">Página {pg} de {totalPaginas}</p>
            <div className="flex gap-2">
              {pg > 1 && <a href={`?q=${q}&pagina=${pg - 1}`} className="text-xs px-3 py-1.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700">← Anterior</a>}
              {pg < totalPaginas && <a href={`?q=${q}&pagina=${pg + 1}`} className="text-xs px-3 py-1.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700">Próxima →</a>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
