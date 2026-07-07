import { createClient } from '@/lib/supabase/server'

export default async function TerminaisPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('empresa_id').eq('id', user!.id).single()
  const empresaId = profile?.empresa_id

  const { data: terminais } = await supabase
    .from('usuarios_pdv')
    .select('id, nome, login, cargo, ativo, created_at')
    .eq('empresa_id', empresaId)
    .order('created_at')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-semibold">Terminais PDV</h1>
          <p className="text-gray-500 text-sm mt-0.5">Credenciais de acesso dos caixas</p>
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-6">
        <p className="text-blue-300 text-sm">
          <strong>Como funciona:</strong> Cada terminal PDV usa login e senha próprios para autenticar no sistema.
          Adicione novos terminais aqui e configure as credenciais nos computadores dos caixas.
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-white text-sm font-medium">Terminais cadastrados</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left px-4 py-3 font-medium">Nome</th>
              <th className="text-left px-4 py-3 font-medium">Login</th>
              <th className="text-left px-4 py-3 font-medium">Cargo</th>
              <th className="text-left px-4 py-3 font-medium">Criado em</th>
              <th className="text-center px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {(terminais ?? []).map(t => (
              <tr key={t.id} className="text-gray-300 hover:bg-gray-800/40 transition-colors">
                <td className="px-4 py-3 text-white font-medium">{t.nome}</td>
                <td className="px-4 py-3 font-mono text-blue-400">{t.login}</td>
                <td className="px-4 py-3 text-gray-400">{t.cargo ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {new Date(t.created_at).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.ativo ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                    {t.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
              </tr>
            ))}
            {(!terminais || terminais.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-600">
                  Nenhum terminal cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
