import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles').select('empresa_id, nome').eq('id', user!.id).single()

  const empresaId = profile?.empresa_id ?? ''
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const inicioHoje = hoje.toISOString()
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString()
  const todayStr = hoje.toISOString().split('T')[0]

  const [
    vendasHojeRes, vendasMesRes,
    produtosRes, clientesRes,
    crRes, cpRes,
    ultimasVendasRes,
    canaisRes, pedidosMarketplaceHojeRes,
  ] = await Promise.all([
    supabase.from('vendas').select('total').eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', inicioHoje),
    supabase.from('vendas').select('total').eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', inicioMes),
    supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId),
    supabase.from('contas_receber').select('valor_original, valor_pago, status, data_vencimento').eq('empresa_id', empresaId).neq('status', 'cancelado'),
    supabase.from('contas_pagar').select('valor, valor_pago, status, vencimento').eq('empresa_id', empresaId).neq('status', 'cancelado'),
    supabase.from('vendas').select('id, numero, total, status, created_at, clientes(nome)').eq('empresa_id', empresaId).gte('created_at', inicioHoje).order('created_at', { ascending: false }).limit(8),
    supabase.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', empresaId).eq('ativo', true),
    supabase.from('marketplace_pedidos').select('valor_total, status, canal_id').eq('empresa_id', empresaId).gte('data_pedido', inicioHoje).not('status', 'in', '(cancelado,devolvido)'),
  ])

  const totalHoje = (vendasHojeRes.data ?? []).reduce((s, v) => s + (v.total ?? 0), 0)
  const qtdHoje = vendasHojeRes.data?.length ?? 0
  const totalMes = (vendasMesRes.data ?? []).reduce((s, v) => s + (v.total ?? 0), 0)

  const canaisConectados = canaisRes.data ?? []
  const pedidosMarketplaceHoje = pedidosMarketplaceHojeRes.data ?? []
  const totalMarketplaceHoje = pedidosMarketplaceHoje.reduce((s, p) => s + Number(p.valor_total ?? 0), 0)
  const qtdMarketplaceHoje = pedidosMarketplaceHoje.length

  const crPendente = (crRes.data ?? []).filter(c => c.status === 'pendente').reduce((s, c) => s + ((c.valor_original ?? 0) - (c.valor_pago ?? 0)), 0)
  const crVencido = (crRes.data ?? []).filter(c => c.status === 'vencido').reduce((s, c) => s + ((c.valor_original ?? 0) - (c.valor_pago ?? 0)), 0)
  const cpPendente = (cpRes.data ?? []).filter(c => c.status === 'pendente').reduce((s, c) => s + ((c.valor ?? 0) - (c.valor_pago ?? 0)), 0)
  const cpHoje = (cpRes.data ?? []).filter(c => c.vencimento === todayStr && c.status === 'pendente').reduce((s, c) => s + ((c.valor ?? 0) - (c.valor_pago ?? 0)), 0)

  const diaSemana = hoje.toLocaleDateString('pt-BR', { weekday: 'long' })
  const dataFmt = hoje.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-slate-400 text-sm capitalize">{diaSemana}, {dataFmt}</p>
          <h1 className="text-slate-900 text-3xl font-bold mt-0.5 tracking-tight">Visão Geral</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-600 border border-emerald-200 px-3 py-1.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Sistema online
          </span>
          <Link href="/pdv" className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-full font-medium transition-colors">
            🖥 Abrir PDV
          </Link>
        </div>
      </div>

      {/* ── KPIs principais ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Vendas hoje"
          value={brl(totalHoje)}
          sub={`${qtdHoje} transaç${qtdHoje === 1 ? 'ão' : 'ões'}`}
          icon="🛒"
          accent="#3b82f6"
          bg="from-blue-50 to-indigo-50"
          href="/dashboard/vendas"
        />
        <KpiCard
          label="Faturamento do mês"
          value={brl(totalMes)}
          sub="vendas concluídas"
          icon="📈"
          accent="#10b981"
          bg="from-emerald-50 to-teal-50"
          href="/dashboard/relatorios/vendas"
        />
        <KpiCard
          label="A receber"
          value={brl(crPendente + crVencido)}
          sub={crVencido > 0 ? `${brl(crVencido)} vencido` : 'em dia'}
          icon="💰"
          accent={crVencido > 0 ? '#f59e0b' : '#10b981'}
          bg={crVencido > 0 ? 'from-amber-50 to-orange-50' : 'from-emerald-50 to-teal-50'}
          href="/dashboard/contas-receber"
          alert={crVencido > 0}
        />
        <KpiCard
          label="A pagar"
          value={brl(cpPendente)}
          sub={cpHoje > 0 ? `${brl(cpHoje)} vencem hoje` : 'sem vencimentos hoje'}
          icon="💳"
          accent={cpHoje > 0 ? '#ef4444' : '#64748b'}
          bg={cpHoje > 0 ? 'from-red-50 to-rose-50' : 'from-slate-50 to-gray-50'}
          href="/dashboard/contas-pagar"
          alert={cpHoje > 0}
        />
      </div>

      {/* ── Vendas dos canais hoje ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-slate-800 font-semibold">Vendas dos Canais Hoje</h2>
          <p className="text-slate-400 text-xs mt-0.5">Comparativo entre os canais de venda da empresa</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl flex-shrink-0">🏬</div>
            <div className="min-w-0">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">PDV Externo</p>
              <p className="text-slate-400 text-lg font-bold truncate">—</p>
              <p className="text-slate-400 text-xs">sem integração ainda</p>
            </div>
          </div>
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center text-xl flex-shrink-0">🏪</div>
            <div className="min-w-0">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Marketplaces</p>
              <p className="text-slate-900 text-lg font-bold truncate">{brl(totalMarketplaceHoje)}</p>
              <p className="text-slate-400 text-xs truncate">
                {canaisConectados.length === 0
                  ? 'nenhum canal conectado'
                  : `${qtdMarketplaceHoje} pedido${qtdMarketplaceHoje === 1 ? '' : 's'} · ${canaisConectados.map(c => c.nome).join(', ')}`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Linha 2: Atalhos rápidos + últimas vendas ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Últimas vendas */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-slate-800 font-semibold">Últimas vendas hoje</h2>
              <p className="text-slate-400 text-xs mt-0.5">{qtdHoje} transações registradas</p>
            </div>
            <Link href="/dashboard/vendas" className="text-blue-600 hover:text-blue-700 text-xs font-medium transition-colors">
              Ver todas →
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {!ultimasVendasRes.data || ultimasVendasRes.data.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-slate-300">
                <span className="text-4xl mb-3">🛒</span>
                <p className="text-slate-400 text-sm">Nenhuma venda hoje ainda</p>
                <Link href="/pdv" className="mt-3 text-blue-600 text-xs font-medium hover:underline">Abrir PDV →</Link>
              </div>
            ) : ultimasVendasRes.data.map(v => {
              const cliente = v.clientes as unknown as { nome: string } | null
              return (
                <div key={v.id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/80 transition-colors">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm">🛒</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800 text-sm font-medium truncate">{cliente?.nome ?? 'Cliente não identificado'}</p>
                    <p className="text-slate-400 text-xs">#{v.numero} · {new Date(v.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-slate-800 font-semibold text-sm">{brl(v.total ?? 0)}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      v.status === 'concluida' ? 'bg-emerald-50 text-emerald-600' :
                      v.status === 'cancelada' ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {v.status === 'concluida' ? 'Concluída' : v.status === 'cancelada' ? 'Cancelada' : v.status}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Atalhos rápidos */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
            <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Acesso rápido</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: '/pdv',                      icon: '🖥',  label: 'PDV',          color: 'bg-blue-50 text-blue-600 hover:bg-blue-100' },
                { href: '/dashboard/contas-receber', icon: '💰',  label: 'A Receber',    color: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' },
                { href: '/dashboard/contas-pagar',   icon: '💳',  label: 'A Pagar',      color: 'bg-rose-50 text-rose-600 hover:bg-rose-100' },
                { href: '/dashboard/produtos',       icon: '📦',  label: 'Produtos',     color: 'bg-violet-50 text-violet-600 hover:bg-violet-100' },
                { href: '/dashboard/clientes',       icon: '👥',  label: 'Clientes',     color: 'bg-amber-50 text-amber-600 hover:bg-amber-100' },
                { href: '/dashboard/entradas/nova',  icon: '📥',  label: 'Entrada',      color: 'bg-teal-50 text-teal-600 hover:bg-teal-100' },
              ].map(item => (
                <Link key={item.href} href={item.href}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-colors ${item.color}`}>
                  <span className="text-xl">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Mini resumo financeiro */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 text-white">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Posição financeira</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-slate-300 text-xs">A receber</span>
                </div>
                <span className="text-emerald-400 text-sm font-semibold">{brl(crPendente + crVencido)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-slate-300 text-xs">A pagar</span>
                </div>
                <span className="text-red-400 text-sm font-semibold">{brl(cpPendente)}</span>
              </div>
              <div className="h-px bg-slate-700" />
              <div className="flex items-center justify-between">
                <span className="text-slate-300 text-xs font-semibold">Saldo líquido</span>
                <span className={`text-sm font-bold ${(crPendente + crVencido - cpPendente) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {brl(crPendente + crVencido - cpPendente)}
                </span>
              </div>
            </div>
            <Link href="/dashboard/relatorios/financeiro"
              className="mt-4 block text-center text-xs text-slate-400 hover:text-white transition-colors">
              Ver fluxo completo →
            </Link>
          </div>

          {/* Cadastros */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
            <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Cadastros</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 text-sm">📦 Produtos ativos</span>
                <span className="font-bold text-slate-800">{(produtosRes.count ?? 0).toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 text-sm">👥 Clientes</span>
                <span className="font-bold text-slate-800">{(clientesRes.count ?? 0).toLocaleString('pt-BR')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, icon, accent, bg, href, alert }: {
  label: string; value: string; sub?: string; icon: string
  accent: string; bg: string; href: string; alert?: boolean
}) {
  return (
    <Link href={href} className={`relative bg-gradient-to-br ${bg} rounded-2xl p-5 border border-white shadow-sm hover:shadow-md transition-all group overflow-hidden`}>
      {alert && (
        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      )}
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-xl shadow-sm">
          {icon}
        </div>
        <div className="h-1 w-12 rounded-full mt-2 opacity-40" style={{ background: accent }} />
      </div>
      <p className="text-slate-500 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-slate-900 text-xl font-bold tracking-tight leading-tight">{value}</p>
      {sub && (
        <p className="text-xs mt-1 font-medium" style={{ color: accent }}>{sub}</p>
      )}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: accent }} />
    </Link>
  )
}
