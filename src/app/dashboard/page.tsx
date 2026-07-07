import { createClient } from '@/lib/supabase/server'

async function getResumo(empresaId: string | null) {
  if (!empresaId) return null
  const supabase = await createClient()

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const inicioHoje = hoje.toISOString()

  const [produtos, clientes, vendasHoje] = await Promise.all([
    supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId),
    supabase.from('vendas').select('total').eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', inicioHoje),
  ])

  const totalVendasHoje = (vendasHoje.data ?? []).reduce((s, v) => s + (v.total ?? 0), 0)

  return {
    produtos: produtos.count ?? 0,
    clientes: clientes.count ?? 0,
    vendasHoje: vendasHoje.data?.length ?? 0,
    totalHoje: totalVendasHoje,
  }
}

function MetricCard({
  titulo, valor, sub, gradiente, iconeBg, icone
}: {
  titulo: string; valor: string; sub?: string
  gradiente: string; iconeBg: string; icone: string
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shadow-sm"
          style={{ background: iconeBg }}
        >
          {icone}
        </div>
        <div
          className="h-1.5 w-14 rounded-full opacity-60"
          style={{ background: gradiente }}
        />
      </div>
      <p className="text-slate-500 text-xs font-medium uppercase tracking-wide mb-1">{titulo}</p>
      <p className="text-slate-900 text-2xl font-bold tracking-tight">{valor}</p>
      {sub && <p className="text-slate-400 text-xs mt-1">{sub}</p>}
    </div>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id')
    .eq('id', user!.id)
    .single()

  const resumo = await getResumo(profile?.empresa_id ?? null)

  const totalFmt = resumo
    ? resumo.totalHoje.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : 'R$ 0,00'

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div>
      {/* Header */}
      <div className="mb-7 flex items-end justify-between">
        <div>
          <p className="text-slate-400 text-sm capitalize">{hoje}</p>
          <h1 className="text-slate-900 text-2xl font-bold mt-0.5">Dashboard</h1>
        </div>
        <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-3 py-1.5 rounded-full font-medium">
          ● Sistema online
        </span>
      </div>

      {resumo ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          <MetricCard
            titulo="Vendas hoje"
            valor={String(resumo.vendasHoje)}
            sub="transações concluídas"
            gradiente="linear-gradient(90deg,#3b82f6,#6366f1)"
            iconeBg="linear-gradient(135deg,#eff6ff,#eef2ff)"
            icone="🛒"
          />
          <MetricCard
            titulo="Faturamento hoje"
            valor={totalFmt}
            sub="vendas concluídas"
            gradiente="linear-gradient(90deg,#10b981,#06b6d4)"
            iconeBg="linear-gradient(135deg,#ecfdf5,#f0fdfa)"
            icone="💵"
          />
          <MetricCard
            titulo="Produtos ativos"
            valor={resumo.produtos.toLocaleString('pt-BR')}
            sub="no catálogo"
            gradiente="linear-gradient(90deg,#a855f7,#ec4899)"
            iconeBg="linear-gradient(135deg,#faf5ff,#fdf2f8)"
            icone="📦"
          />
          <MetricCard
            titulo="Clientes"
            valor={resumo.clientes.toLocaleString('pt-BR')}
            sub="cadastrados"
            gradiente="linear-gradient(90deg,#f59e0b,#f97316)"
            iconeBg="linear-gradient(135deg,#fffbeb,#fff7ed)"
            icone="👥"
          />
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-7">
          <p className="text-amber-700 text-sm">
            Perfil não configurado. Acesse o Supabase e vincule seu usuário a uma empresa na tabela <code className="bg-amber-100 px-1 rounded">profiles</code>.
          </p>
        </div>
      )}

      {/* Últimas vendas */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-slate-800 font-semibold text-base">Últimas vendas do dia</h2>
            <p className="text-slate-400 text-xs mt-0.5">Transações registradas hoje</p>
          </div>
          <a href="/dashboard/vendas" className="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors">
            Ver todas →
          </a>
        </div>
        <div className="px-6 py-4">
          <UltimasVendas empresaId={profile?.empresa_id} />
        </div>
      </div>
    </div>
  )
}

async function UltimasVendas({ empresaId }: { empresaId?: string }) {
  if (!empresaId) return <p className="text-slate-400 text-sm">Sem dados.</p>

  const supabase = await createClient()
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)

  const { data: vendas } = await supabase
    .from('vendas')
    .select('id, numero, total, status, created_at, clientes(nome)')
    .eq('empresa_id', empresaId)
    .gte('created_at', hoje.toISOString())
    .order('created_at', { ascending: false })
    .limit(10)

  if (!vendas || vendas.length === 0) {
    return (
      <div className="flex flex-col items-center py-10 text-slate-300">
        <span className="text-5xl mb-3">🛒</span>
        <p className="text-slate-400 text-sm">Nenhuma venda registrada hoje.</p>
        <a href="/pdv" className="mt-3 text-blue-600 text-sm hover:underline">Abrir PDV →</a>
      </div>
    )
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
          <th className="text-left pb-3 font-medium">#</th>
          <th className="text-left pb-3 font-medium">Cliente</th>
          <th className="text-left pb-3 font-medium">Horário</th>
          <th className="text-left pb-3 font-medium">Status</th>
          <th className="text-right pb-3 font-medium">Total</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {vendas.map(v => (
          <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
            <td className="py-3 text-slate-400 font-mono text-xs">{v.numero}</td>
            <td className="py-3 text-slate-700 font-medium">
              {(v.clientes as unknown as { nome: string } | null)?.nome ?? <span className="text-slate-400 italic">Sem cliente</span>}
            </td>
            <td className="py-3 text-slate-400 text-xs">
              {new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </td>
            <td className="py-3">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                v.status === 'concluida' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                v.status === 'cancelada' ? 'bg-red-50 text-red-500 border border-red-100' :
                'bg-slate-100 text-slate-500'
              }`}>
                {v.status === 'concluida' ? 'Concluída' : v.status === 'cancelada' ? 'Cancelada' : v.status}
              </span>
            </td>
            <td className="py-3 text-right font-semibold text-slate-800">
              {(v.total ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
