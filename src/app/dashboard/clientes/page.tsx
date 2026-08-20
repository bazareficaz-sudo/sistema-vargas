import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import NovoClienteBotao from '@/components/clientes/NovoClienteBotao'

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
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id

  let query = supabase
    .from('clientes')
    .select('id, nome, cpf_cnpj, telefone, cidade, estado, saldo_credito, saldo_devedor, status_credito, ativo', { count: 'exact' })
    .eq('empresa_id', empresaId)
    // Cadastro unificado noutro não aparece: continua no banco pelo
    // histórico, mas listá-lo faz o mesmo cliente surgir duas vezes — foi
    // o que aconteceu com o ESCRITORIO ROCHA RANGEL depois de unificado
    // (ver supabase-cliente-mesclado-redirecionar.sql).
    .is('mesclado_em', null)
    .order('nome')
    .range(offset, offset + POR_PAGINA - 1)

  // Buscar só por nome obrigava a saber como o cliente foi cadastrado.
  // Documento e telefone são o que o balconista tem na mão.
  if (q) {
    const digitos = q.replace(/\D/g, '')
    const alvos = [`nome.ilike.%${q}%`]
    if (digitos.length >= 3) {
      alvos.push(`cpf_cnpj.ilike.%${digitos}%`, `telefone.ilike.%${digitos}%`)
    }
    query = query.or(alvos.join(','))
  }

  const { data: clientes, count } = await query
  const totalPaginas = Math.ceil((count ?? 0) / POR_PAGINA)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">{count?.toLocaleString('pt-BR')} clientes cadastrados</p>
        </div>
        <NovoClienteBotao empresaId={empresaId ?? ''} />
      </div>

      <form className="mb-4">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nome, CPF/CNPJ ou telefone..."
          className="bg-white border border-gray-300 text-gray-800 rounded-lg px-4 py-2 text-sm w-72 focus:outline-none focus:border-blue-500 placeholder-gray-400"
        />
        <button type="submit" className="ml-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          Buscar
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-medium">Nome</th>
              <th className="text-left px-4 py-3 font-medium">CPF/CNPJ</th>
              <th className="text-left px-4 py-3 font-medium">Telefone</th>
              <th className="text-left px-4 py-3 font-medium">Cidade</th>
              <th className="text-right px-4 py-3 font-medium">Crédito</th>
              <th className="text-right px-4 py-3 font-medium">Débito</th>
              <th className="text-center px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(clientes ?? []).map(c => (
              <tr key={c.id} className="text-gray-600 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-gray-900 font-medium">
                  <Link href={`/dashboard/clientes/${c.id}`} className="hover:text-blue-600 transition-colors">{c.nome}</Link>
                </td>
                <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{c.cpf_cnpj ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-400">{c.telefone ?? '—'}</td>
                <td className="px-4 py-2.5 text-gray-400">{c.cidade ? `${c.cidade}/${c.estado}` : '—'}</td>
                <td className="px-4 py-2.5 text-right text-emerald-600">
                  {(c.saldo_credito ?? 0) > 0
                    ? (c.saldo_credito ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-red-600">
                  {(c.saldo_devedor ?? 0) > 0
                    ? (c.saldo_devedor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    c.status_credito === 'liberado' ? 'bg-green-100 text-green-700 border-green-200' :
                    c.status_credito === 'bloqueado' ? 'bg-red-100 text-red-600 border-red-200' :
                    'bg-yellow-100 text-yellow-700 border-yellow-200'
                  }`}>
                    {c.status_credito ?? 'liberado'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-gray-500 text-xs">Página {pg} de {totalPaginas}</p>
            <div className="flex gap-2">
              {pg > 1 && <a href={`?q=${q}&pagina=${pg - 1}`} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">← Anterior</a>}
              {pg < totalPaginas && <a href={`?q=${q}&pagina=${pg + 1}`} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">Próxima →</a>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
