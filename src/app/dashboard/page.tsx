import { createClient } from '@/lib/supabase/server'
import { loadPlanData } from '@/lib/plans/access'
import { permissoesEfetivas, buscarExcecoes, type Papel } from '@/lib/auth/permissoes'
import FiltroMes from '@/components/dashboard/FiltroMes'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ymd = (d: Date) => d.toISOString().slice(0, 10)

type CompraRow = { valor_total: number | null; fornecedor_id: string | null; data_emissao: string | null; data_entrada?: string | null; nome_fornecedor?: string | null }

export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<{ mes?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles').select('empresa_id, nome').eq('id', user!.id).single()

  const empresaId = profile?.empresa_id ?? ''
  const plan = await loadPlanData(empresaId, user!.id)

  // Painel financeiro da Visao Geral respeita a permissao do usuario: sem
  // 'ver_dashboard_financeiro' o funcionario entra na tela e nao ve venda do
  // dia, faturamento do mes nem contas. Vale por usuario, configurado em
  // Usuarios -> Permissoes.
  const { data: perfilPermissao } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  const permissoesUsuario = permissoesEfetivas(
    (perfilPermissao?.role ?? null) as Papel | null,
    await buscarExcecoes(supabase, user!.id),
  )
  const podeVerFinanceiro = permissoesUsuario.includes('ver_dashboard_financeiro')
  const tem = (modulo: string) => plan.modulos.includes('*') || plan.modulos.includes(modulo)
  const temVendas = tem('vendas') || tem('pdv')
  const temCompras = tem('entradas') || tem('entradas_xml')

  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const inicioHoje = hoje.toISOString()
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString()
  const todayStr = ymd(hoje)

  // ── Mês selecionado pro widget de compras ──────────────────────────────
  const { mes: mesParam } = await searchParams
  const mesValido = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  const [anoSel, mesSelNum] = mesValido.split('-').map(Number)
  const inicioMesSel = new Date(anoSel, mesSelNum - 1, 1)
  const inicioProxMesSel = new Date(anoSel, mesSelNum, 1)
  const inicioMesAntSel = new Date(anoSel, mesSelNum - 2, 1)
  const inicioMesSelStr = ymd(inicioMesSel)
  const inicioProxMesSelStr = ymd(inicioProxMesSel)
  const inicioMesAntSelStr = ymd(inicioMesAntSel)

  if (tem('contas_pagar')) {
    try { await supabase.rpc('atualizar_contas_vencidas') } catch {}
  }

  const [
    vendasHojeRes, vendasMesRes,
    produtosRes, clientesRes, fornecedoresCountRes,
    crRes, cpRes,
    ultimasVendasRes,
    canaisRes, pedidosMarketplaceHojeRes,
    entradasCompraRes, nfeEntradasCompraRes,
    fornecedoresListRes,
  ] = await Promise.all([
    temVendas ? supabase.from('vendas').select('total').eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', inicioHoje) : Promise.resolve({ data: [] as any[] }),
    temVendas ? supabase.from('vendas').select('total').eq('empresa_id', empresaId).eq('status', 'concluida').gte('created_at', inicioMes) : Promise.resolve({ data: [] as any[] }),
    tem('produtos') ? supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('ativo', true) : Promise.resolve({ count: null }),
    tem('clientes') ? supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId) : Promise.resolve({ count: null }),
    tem('fornecedores') ? supabase.from('fornecedores').select('id', { count: 'exact', head: true }).eq('empresa_id', empresaId) : Promise.resolve({ count: null }),
    tem('contas_receber') ? supabase.from('contas_receber').select('valor_aberto, status, data_vencimento').eq('empresa_id', empresaId).not('status', 'in', '(cancelado,recebido,renegociado)') : Promise.resolve({ data: [] as any[] }),
    tem('contas_pagar') ? supabase.from('contas_pagar').select('valor, status, vencimento').eq('empresa_id', empresaId).neq('status', 'cancelado') : Promise.resolve({ data: [] as any[] }),
    temVendas ? supabase.from('vendas').select('id, numero, total, status, created_at, clientes(nome)').eq('empresa_id', empresaId).gte('created_at', inicioHoje).order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as any[] }),
    tem('marketplace') ? supabase.from('marketplace_canais').select('id, nome, plataforma').eq('empresa_id', empresaId).eq('ativo', true) : Promise.resolve({ data: [] as any[] }),
    tem('marketplace') ? supabase.from('marketplace_pedidos').select('valor_total, status, canal_id').eq('empresa_id', empresaId).gte('data_pedido', inicioHoje).not('status', 'in', '(cancelado,devolvido)') : Promise.resolve({ data: [] as any[] }),
    // Entrada manual não tem nota, então quase nunca tem data de emissão
    // (4 de 31 em produção) — a data que sempre existe é a da entrada da
    // mercadoria. Filtrar só por data_emissao descartava as manuais inteiras
    // e o card de compras mostrava apenas o que veio de XML.
    (temCompras && tem('entradas')) ? supabase.from('entradas').select('valor_total, fornecedor_id, data_emissao, data_entrada').eq('empresa_id', empresaId).neq('status', 'cancelada').or(`and(data_emissao.gte.${inicioMesAntSelStr},data_emissao.lt.${inicioProxMesSelStr}),and(data_emissao.is.null,data_entrada.gte.${inicioMesAntSelStr},data_entrada.lt.${inicioProxMesSelStr})`) : Promise.resolve({ data: [] as CompraRow[] }),
    (temCompras && tem('entradas_xml')) ? supabase.from('nfe_entradas').select('valor_total, fornecedor_id, nome_fornecedor, data_emissao').eq('empresa_id', empresaId).neq('status', 'cancelada').gte('data_emissao', inicioMesAntSelStr).lt('data_emissao', inicioProxMesSelStr) : Promise.resolve({ data: [] as CompraRow[] }),
    (temCompras && tem('fornecedores')) ? supabase.from('fornecedores').select('id, razao_social, nome_fantasia').eq('empresa_id', empresaId) : Promise.resolve({ data: [] as any[] }),
  ])

  const totalHoje = (vendasHojeRes.data ?? []).reduce((s, v) => s + (v.total ?? 0), 0)
  const qtdHoje = vendasHojeRes.data?.length ?? 0
  const totalMes = (vendasMesRes.data ?? []).reduce((s, v) => s + (v.total ?? 0), 0)

  const canaisConectados = canaisRes.data ?? []
  const pedidosMarketplaceHoje = pedidosMarketplaceHojeRes.data ?? []
  const totalMarketplaceHoje = pedidosMarketplaceHoje.reduce((s, p) => s + Number(p.valor_total ?? 0), 0)
  const qtdMarketplaceHoje = pedidosMarketplaceHoje.length

  // status real: aberto | parcial | recebido | vencido | cancelado | renegociado
  // (não "pendente" — e valor_aberto já vem calculado do banco, sem valor_pago)
  const crPendente = (crRes.data ?? []).filter(c => ['aberto', 'parcial'].includes(c.status)).reduce((s, c) => s + (c.valor_aberto ?? 0), 0)
  const crVencido = (crRes.data ?? []).filter(c => c.status === 'vencido').reduce((s, c) => s + (c.valor_aberto ?? 0), 0)

  // Sem valor_pago — a coluna não existe em contas_pagar. "Vencida" é
  // calculado na hora (não só pelo status, que só é promovido pela RPC
  // acima) pra nunca ficar desatualizado mesmo se a RPC falhar.
  const cp = cpRes.data ?? []
  const cpVencidas = cp.filter(c => c.status === 'vencido' || (c.status === 'pendente' && c.vencimento < todayStr)).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpHoje = cp.filter(c => c.status === 'pendente' && c.vencimento === todayStr).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpAVencer = cp.filter(c => c.status === 'pendente' && c.vencimento > todayStr).reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const cpTotal = cpVencidas + cpHoje + cpAVencer

  // ── Compras do mês (entradas manuais + XML combinadas) ─────────────────
  const comprasRows: CompraRow[] = [...(entradasCompraRes.data ?? []), ...(nfeEntradasCompraRes.data ?? [])]
  // A data da nota quando existe; senão, a data em que a mercadoria entrou.
  // Fatia em 10 porque data_entrada pode vir com hora e a comparação é com
  // 'AAAA-MM-DD'.
  const dataDaCompra = (r: CompraRow) => r.data_emissao ?? (r.data_entrada ? String(r.data_entrada).slice(0, 10) : null)
  const comprasMesAtual = comprasRows.filter(r => { const d = dataDaCompra(r); return d && d >= inicioMesSelStr && d < inicioProxMesSelStr })
  const comprasMesAnterior = comprasRows.filter(r => { const d = dataDaCompra(r); return d && d < inicioMesSelStr })
  const totalComprasMes = comprasMesAtual.reduce((s, r) => s + Number(r.valor_total ?? 0), 0)
  const totalComprasMesAnterior = comprasMesAnterior.reduce((s, r) => s + Number(r.valor_total ?? 0), 0)
  const variacaoCompras = totalComprasMesAnterior > 0 ? ((totalComprasMes - totalComprasMesAnterior) / totalComprasMesAnterior) * 100 : null

  const fornecedorNomePorId = new Map((fornecedoresListRes.data ?? []).map((f: any) => [f.id, f.nome_fantasia ?? f.razao_social]))
  const comprasPorFornecedor = new Map<string, { nome: string; total: number }>()
  for (const r of comprasMesAtual) {
    const chave = r.fornecedor_id ?? r.nome_fornecedor ?? 'sem-fornecedor'
    const nome = (r.fornecedor_id && fornecedorNomePorId.get(r.fornecedor_id)) || r.nome_fornecedor || 'Sem fornecedor identificado'
    const atual = comprasPorFornecedor.get(chave) ?? { nome, total: 0 }
    atual.total += Number(r.valor_total ?? 0)
    comprasPorFornecedor.set(chave, atual)
  }
  const rankingFornecedores = [...comprasPorFornecedor.values()].sort((a, b) => b.total - a.total).slice(0, 5)

  const diaSemana = hoje.toLocaleDateString('pt-BR', { weekday: 'long' })
  const dataFmt = hoje.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

  const ATALHOS = [
    { href: '/pdv', icon: '🖥', label: 'PDV', color: 'bg-blue-50 text-blue-600 hover:bg-blue-100', mod: 'pdv' },
    { href: '/dashboard/contas-receber', icon: '💰', label: 'A Receber', color: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100', mod: 'contas_receber' },
    { href: '/dashboard/contas-pagar', icon: '💳', label: 'A Pagar', color: 'bg-rose-50 text-rose-600 hover:bg-rose-100', mod: 'contas_pagar' },
    { href: '/dashboard/produtos', icon: '📦', label: 'Produtos', color: 'bg-violet-50 text-violet-600 hover:bg-violet-100', mod: 'produtos' },
    { href: '/dashboard/clientes', icon: '👥', label: 'Clientes', color: 'bg-amber-50 text-amber-600 hover:bg-amber-100', mod: 'clientes' },
    { href: '/dashboard/entradas/nova', icon: '📥', label: 'Entrada', color: 'bg-teal-50 text-teal-600 hover:bg-teal-100', mod: 'entradas' },
    { href: '/dashboard/entradas-xml', icon: '📄', label: 'XML / NF-e', color: 'bg-sky-50 text-sky-600 hover:bg-sky-100', mod: 'entradas_xml' },
    { href: '/dashboard/fornecedores', icon: '🏭', label: 'Fornecedores', color: 'bg-orange-50 text-orange-600 hover:bg-orange-100', mod: 'fornecedores' },
  ].filter(a => tem(a.mod))

  const nadaAtivo = !temVendas && !temCompras && !tem('contas_pagar') && !tem('contas_receber') && !tem('marketplace')

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
          {tem('pdv') && (
            <Link href="/pdv" className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-full font-medium transition-colors">
              🖥 Abrir PDV
            </Link>
          )}
        </div>
      </div>

      {nadaAtivo && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center text-slate-400">
          Nenhum módulo com dados pra mostrar aqui ainda.
        </div>
      )}

      {/* ── KPIs principais ────────────────────────────────────────────────── */}
      {podeVerFinanceiro && (temVendas || tem('contas_receber') || tem('contas_pagar')) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {temVendas && (
            <KpiCard
              label="Vendas hoje" value={brl(totalHoje)} sub={`${qtdHoje} transaç${qtdHoje === 1 ? 'ão' : 'ões'}`}
              icon="🛒" accent="#3b82f6" bg="from-blue-50 to-indigo-50" href="/dashboard/vendas"
            />
          )}
          {temVendas && (
            <KpiCard
              label="Faturamento do mês" value={brl(totalMes)} sub="vendas concluídas"
              icon="📈" accent="#10b981" bg="from-emerald-50 to-teal-50" href="/dashboard/relatorios/vendas"
            />
          )}
          {tem('contas_receber') && (
            <KpiCard
              label="A receber" value={brl(crPendente + crVencido)} sub={crVencido > 0 ? `${brl(crVencido)} vencido` : 'em dia'}
              icon="💰" accent={crVencido > 0 ? '#f59e0b' : '#10b981'} bg={crVencido > 0 ? 'from-amber-50 to-orange-50' : 'from-emerald-50 to-teal-50'}
              href="/dashboard/contas-receber" alert={crVencido > 0}
            />
          )}
          {tem('contas_pagar') && (
            <KpiCard
              label="A pagar" value={brl(cpTotal)} sub={cpVencidas > 0 ? `${brl(cpVencidas)} vencido` : cpHoje > 0 ? `${brl(cpHoje)} vencem hoje` : 'em dia'}
              icon="💳" accent={cpVencidas > 0 ? '#ef4444' : cpHoje > 0 ? '#f59e0b' : '#64748b'} bg={cpVencidas > 0 ? 'from-red-50 to-rose-50' : 'from-slate-50 to-gray-50'}
              href="/dashboard/contas-pagar" alert={cpVencidas > 0}
            />
          )}
        </div>
      )}

      {/* ── Contas a pagar detalhado ───────────────────────────────────────── */}
      {tem('contas_pagar') && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-slate-800 font-semibold">Contas a Pagar</h2>
            <p className="text-slate-400 text-xs mt-0.5">Situação atual dos vencimentos</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <InfoChip label="Vencidas" value={brl(cpVencidas)} cor={cpVencidas > 0 ? 'text-red-600' : 'text-slate-400'} />
            <InfoChip label="Vencendo hoje" value={brl(cpHoje)} cor={cpHoje > 0 ? 'text-amber-600' : 'text-slate-400'} />
            <InfoChip label="A vencer" value={brl(cpAVencer)} cor="text-slate-700" />
          </div>
        </div>
      )}

      {/* ── Compras do mês + Fornecedor que mais comprou ───────────────────── */}
      {temCompras && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-slate-800 font-semibold">Compras do mês</h2>
                <p className="text-slate-400 text-xs mt-0.5">Entradas manuais + XML/NF-e</p>
              </div>
              <FiltroMes mesSelecionado={mesValido} />
            </div>
            <div className="px-5 py-5">
              <p className="text-slate-900 text-2xl font-bold">{brl(totalComprasMes)}</p>
              <p className="text-xs mt-1 text-slate-500">
                {comprasMesAtual.length} nota{comprasMesAtual.length === 1 ? '' : 's'}
                {variacaoCompras !== null && (
                  <span className={variacaoCompras >= 0 ? 'text-red-500 ml-2' : 'text-emerald-500 ml-2'}>
                    {variacaoCompras >= 0 ? '▲' : '▼'} {Math.abs(variacaoCompras).toFixed(0)}% vs. mês anterior
                  </span>
                )}
              </p>
            </div>
          </div>

          {tem('fornecedores') && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-slate-800 font-semibold">Fornecedor que mais comprou</h2>
                <p className="text-slate-400 text-xs mt-0.5">No mês selecionado</p>
              </div>
              {rankingFornecedores.length === 0 ? (
                <p className="px-5 py-8 text-center text-slate-400 text-sm">Nenhuma compra neste mês.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {rankingFornecedores.map((f, i) => (
                    <div key={f.nome + i} className="flex items-center justify-between px-5 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-semibold text-slate-400 w-4">{i + 1}º</span>
                        <span className="text-sm text-slate-700 truncate">{f.nome}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-800 flex-shrink-0">{brl(f.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Vendas dos canais hoje ─────────────────────────────────────────── */}
      {tem('marketplace') && (
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
      )}

      {/* ── Linha final: últimas vendas / atalhos / financeiro / cadastros ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {temVendas && (
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
              ) : ultimasVendasRes.data.map((v: any) => {
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
        )}

        <div className={`space-y-4 ${temVendas ? '' : 'lg:col-span-3'}`}>
          {ATALHOS.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Acesso rápido</p>
              <div className="grid grid-cols-2 gap-2">
                {ATALHOS.map(item => (
                  <Link key={item.href} href={item.href}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-medium transition-colors ${item.color}`}>
                    <span className="text-xl">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(tem('contas_receber') || tem('contas_pagar')) && (
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-4 text-white">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Posição financeira</p>
              <div className="space-y-3">
                {tem('contas_receber') && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-slate-300 text-xs">A receber</span>
                    </div>
                    <span className="text-emerald-400 text-sm font-semibold">{brl(crPendente + crVencido)}</span>
                  </div>
                )}
                {tem('contas_pagar') && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-400" />
                      <span className="text-slate-300 text-xs">A pagar</span>
                    </div>
                    <span className="text-red-400 text-sm font-semibold">{brl(cpTotal)}</span>
                  </div>
                )}
                {tem('contas_receber') && tem('contas_pagar') && (
                  <>
                    <div className="h-px bg-slate-700" />
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 text-xs font-semibold">Saldo líquido</span>
                      <span className={`text-sm font-bold ${(crPendente + crVencido - cpTotal) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {brl(crPendente + crVencido - cpTotal)}
                      </span>
                    </div>
                  </>
                )}
              </div>
              {tem('relatorios_avancados') && (
                <Link href="/dashboard/relatorios/financeiro"
                  className="mt-4 block text-center text-xs text-slate-400 hover:text-white transition-colors">
                  Ver fluxo completo →
                </Link>
              )}
            </div>
          )}

          {(tem('produtos') || tem('clientes') || tem('fornecedores')) && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
              <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-3">Cadastros</p>
              <div className="space-y-2">
                {tem('produtos') && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 text-sm">📦 Produtos ativos</span>
                    <span className="font-bold text-slate-800">{(produtosRes.count ?? 0).toLocaleString('pt-BR')}</span>
                  </div>
                )}
                {tem('clientes') && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 text-sm">👥 Clientes</span>
                    <span className="font-bold text-slate-800">{(clientesRes.count ?? 0).toLocaleString('pt-BR')}</span>
                  </div>
                )}
                {tem('fornecedores') && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 text-sm">🏭 Fornecedores</span>
                    <span className="font-bold text-slate-800">{(fornecedoresCountRes.count ?? 0).toLocaleString('pt-BR')}</span>
                  </div>
                )}
              </div>
            </div>
          )}
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

function InfoChip({ label, value, cor }: { label: string; value: string; cor: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${cor}`}>{value}</p>
    </div>
  )
}
