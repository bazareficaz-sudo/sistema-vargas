import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function FinanceiroPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await perfilDaSessao(supabase, user.id)
  const empresaId = profile?.empresa_id ?? ''

  const hoje = new Date().toISOString().split('T')[0]
  const em7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  const em30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

  try { await supabase.rpc('atualizar_contas_vencidas') } catch {}

  const [crRes, cpRes, vendasMesRes] = await Promise.all([
    supabase.from('contas_receber')
      .select('valor_original, valor_recebido, valor_aberto, status, data_vencimento')
      .eq('empresa_id', empresaId)
      .not('status', 'in', '(cancelado,renegociado)'),
    supabase.from('contas_pagar')
      .select('valor, status, vencimento')
      .eq('empresa_id', empresaId)
      .neq('status', 'cancelado'),
    supabase.from('vendas')
      .select('total')
      .eq('empresa_id', empresaId)
      .eq('status', 'concluida')
      .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
  ])

  const cr = crRes.data ?? []
  const cp = cpRes.data ?? []

  // status real de contas_receber: aberto | parcial | recebido | vencido |
  // cancelado | renegociado (não "pendente") — e valor_aberto já vem
  // calculado do banco (valor_original - valor_recebido), sem valor_pago.
  const crVencido = cr.filter(c => c.status === 'vencido').reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
  const crPendente = cr.filter(c => ['aberto', 'parcial'].includes(c.status)).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
  const crRecebido = cr.filter(c => c.status === 'recebido').reduce((s, c) => s + (c.valor_recebido ?? 0), 0)
  const crVence7 = cr.filter(c => ['aberto', 'parcial'].includes(c.status) && c.data_vencimento >= hoje && c.data_vencimento <= em7).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
  const crVence30 = cr.filter(c => ['aberto', 'parcial'].includes(c.status) && c.data_vencimento >= hoje && c.data_vencimento <= em30).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)

  // status real de contas_pagar: pendente | pago | vencido | cancelado —
  // sem valor_pago (não existe a coluna, e não há pagamento parcial aqui).
  const cpVencido = cp.filter(c => c.status === 'vencido').reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpPendente = cp.filter(c => c.status === 'pendente').reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpPago = cp.filter(c => c.status === 'pago').reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpVence7 = cp.filter(c => c.status === 'pendente' && c.vencimento >= hoje && c.vencimento <= em7).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpHoje = cp.filter(c => c.vencimento === hoje && c.status === 'pendente').reduce((s, c) => s + Number(c.valor ?? 0), 0)

  const faturamentoMes = (vendasMesRes.data ?? []).reduce((s, v) => s + (v.total ?? 0), 0)
  const saldoLiquido = (crPendente + crVencido) - (cpPendente + cpVencido)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-slate-400 text-sm">Módulo Financeiro</p>
          <h1 className="text-slate-900 text-3xl font-bold tracking-tight mt-0.5">Financeiro</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/contas-receber"
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors">
            + Lançar recebimento
          </Link>
          <Link href="/dashboard/contas-pagar"
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-medium transition-colors">
            + Lançar pagamento
          </Link>
        </div>
      </div>

      {/* KPIs topo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm text-lg">💰</div>
            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">A RECEBER</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{brl(crPendente + crVencido)}</p>
          {crVencido > 0 && <p className="text-xs text-red-500 font-medium mt-1">⚠ {brl(crVencido)} vencido</p>}
          {crVencido === 0 && <p className="text-xs text-emerald-600 mt-1">✓ Sem vencidos</p>}
        </div>

        <div className="bg-gradient-to-br from-rose-50 to-red-50 border border-rose-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm text-lg">💳</div>
            <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-semibold">A PAGAR</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{brl(cpPendente + cpVencido)}</p>
          {cpHoje > 0 && <p className="text-xs text-red-500 font-medium mt-1">⚠ {brl(cpHoje)} vencem hoje</p>}
          {cpHoje === 0 && <p className="text-xs text-slate-400 mt-1">Sem vencimentos hoje</p>}
        </div>

        <div className={`bg-gradient-to-br border rounded-2xl p-5 ${saldoLiquido >= 0 ? 'from-blue-50 to-indigo-50 border-blue-100' : 'from-red-50 to-rose-50 border-red-100'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm text-lg">⚖️</div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${saldoLiquido >= 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>SALDO LÍQUIDO</span>
          </div>
          <p className={`text-2xl font-bold ${saldoLiquido >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{brl(saldoLiquido)}</p>
          <p className="text-xs text-slate-400 mt-1">{saldoLiquido >= 0 ? 'Posição positiva' : 'Atenção: posição negativa'}</p>
        </div>

        <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm text-lg">📈</div>
            <span className="text-[10px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-semibold">FATURAMENTO MÊS</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{brl(faturamentoMes)}</p>
          <p className="text-xs text-slate-400 mt-1">Vendas concluídas</p>
        </div>
      </div>

      {/* Linha 2: Receber + Pagar detalhado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Contas a Receber */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">💰</div>
              <div>
                <h2 className="text-slate-800 font-semibold text-sm">Contas a Receber</h2>
                <p className="text-slate-400 text-xs">{cr.length} registros</p>
              </div>
            </div>
            <Link href="/dashboard/contas-receber" className="text-emerald-600 hover:text-emerald-700 text-xs font-medium">
              Ver todas →
            </Link>
          </div>
          <div className="p-5 space-y-3">
            <BarLine label="Vencido" value={crVencido} total={crPendente + crVencido + crRecebido} color="bg-red-400" textColor="text-red-600" />
            <BarLine label="A vencer" value={crPendente} total={crPendente + crVencido + crRecebido} color="bg-amber-400" textColor="text-amber-600" />
            <BarLine label="Recebido" value={crRecebido} total={crPendente + crVencido + crRecebido} color="bg-emerald-400" textColor="text-emerald-600" />
          </div>
          <div className="px-5 pb-4 grid grid-cols-2 gap-2">
            <InfoChip label="Próx. 7 dias" value={brl(crVence7)} color="text-amber-600" bg="bg-amber-50" />
            <InfoChip label="Próx. 30 dias" value={brl(crVence30)} color="text-blue-600" bg="bg-blue-50" />
          </div>
        </div>

        {/* Contas a Pagar */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-rose-50 rounded-xl flex items-center justify-center">💳</div>
              <div>
                <h2 className="text-slate-800 font-semibold text-sm">Contas a Pagar</h2>
                <p className="text-slate-400 text-xs">{cp.length} registros</p>
              </div>
            </div>
            <Link href="/dashboard/contas-pagar" className="text-rose-600 hover:text-rose-700 text-xs font-medium">
              Ver todas →
            </Link>
          </div>
          <div className="p-5 space-y-3">
            <BarLine label="Vencido" value={cpVencido} total={cpPendente + cpVencido + cpPago} color="bg-red-400" textColor="text-red-600" />
            <BarLine label="A vencer" value={cpPendente} total={cpPendente + cpVencido + cpPago} color="bg-amber-400" textColor="text-amber-600" />
            <BarLine label="Pago" value={cpPago} total={cpPendente + cpVencido + cpPago} color="bg-emerald-400" textColor="text-emerald-600" />
          </div>
          <div className="px-5 pb-4 grid grid-cols-2 gap-2">
            <InfoChip label="Vence hoje" value={brl(cpHoje)} color={cpHoje > 0 ? 'text-red-600' : 'text-slate-500'} bg={cpHoje > 0 ? 'bg-red-50' : 'bg-slate-50'} />
            <InfoChip label="Próx. 7 dias" value={brl(cpVence7)} color="text-amber-600" bg="bg-amber-50" />
          </div>
        </div>
      </div>

      {/* Linha 3: Atalhos de módulos */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-4">Módulos financeiros</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { href: '/dashboard/contas-receber',           icon: '💰', label: 'Contas a Receber',    color: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700' },
            { href: '/dashboard/contas-pagar',             icon: '💳', label: 'Contas a Pagar',      color: 'bg-rose-50 hover:bg-rose-100 text-rose-700' },
            { href: '/dashboard/cobranca',                 icon: '📞', label: 'Cobranças',           color: 'bg-amber-50 hover:bg-amber-100 text-amber-700' },
            { href: '/dashboard/creditos-clientes',        icon: '🎫', label: 'Créditos',            color: 'bg-violet-50 hover:bg-violet-100 text-violet-700' },
            { href: '/dashboard/relatorios/financeiro',    icon: '📊', label: 'Fluxo Financeiro',    color: 'bg-blue-50 hover:bg-blue-100 text-blue-700' },
            { href: '/dashboard/relatorios',               icon: '📈', label: 'BI & Relatórios',     color: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700' },
          ].map(m => (
            <Link key={m.href} href={m.href}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl text-center text-xs font-semibold transition-colors ${m.color}`}>
              <span className="text-2xl">{m.icon}</span>
              <span className="leading-tight">{m.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function BarLine({ label, value, total, color, textColor }: {
  label: string; value: number; total: number; color: string; textColor: string
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={`text-xs font-semibold ${textColor}`}>{brl(value)}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function InfoChip({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl px-3 py-2`}>
      <p className="text-slate-400 text-[10px] font-medium">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  )
}
