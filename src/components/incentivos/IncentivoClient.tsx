'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import PlanoModal from './PlanoModal'

interface Regra { id: string; tipo: string; alvo_tipo: string; valor: number; ativo: boolean }
interface Meta  { id: string; nome: string; tipo: string; valor_meta: number; periodo: string }
interface Bonus { id: string; nome: string; tipo: string; valor: number }
interface Part  { id: string; vendedor_id: string; todos_vendedores: boolean }

interface Plano {
  id: string; nome: string; descricao?: string; tipo: string; status: string
  prioridade: number; vigencia_inicio?: string; vigencia_fim?: string
  abrangencia: string; recorrencia: string; icone?: string; cor?: string
  observacoes?: string; created_at: string
  incentivo_regras: Regra[]
  incentivo_metas: Meta[]
  incentivo_bonus: Bonus[]
  incentivo_participantes: Part[]
}

interface Resultado {
  id: string; plano_id: string; vendedor_id: string; periodo_inicio: string; periodo_fim: string
  valor_vendido: number; valor_base_comissao: number; comissao_calculada: number; bonus_calculado: number
  pontos_ganhos: number; meta_valor: number; meta_atingida: number; percentual_meta: number; meta_batida: boolean
  status: string; aprovado_em?: string; pago_em?: string; observacao?: string
  vendedores: { id: string; nome: string; apelido?: string } | null
}

interface Vendedor { id: string; codigo?: string; nome: string; apelido?: string; status: string }

interface Props {
  planos: Plano[]
  vendedores: Vendedor[]
  resultados: Resultado[]
  historico: any[]
  empresaId: string
  role: string
  stats: { planosAtivos: number; participantes: number; pendente: number }
}

const TIPO_CFG: Record<string, { label: string; icon: string; cor: string; bg: string }> = {
  comissao:    { label: 'Comissão',    icon: '💰', cor: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  meta:        { label: 'Meta',        icon: '🎯', cor: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  bonus:       { label: 'Bônus',       icon: '🎁', cor: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  premiacao:   { label: 'Premiação',   icon: '🏆', cor: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200' },
  cashback:    { label: 'Cashback',    icon: '🔄', cor: 'text-cyan-700',   bg: 'bg-cyan-50 border-cyan-200' },
  campanha:    { label: 'Campanha',    icon: '🔥', cor: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  gamificacao: { label: 'Gamificação', icon: '🎮', cor: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  rascunho: { label: 'Rascunho', cls: 'bg-slate-100 text-slate-500 border border-slate-200' },
  ativo:    { label: 'Ativo',    cls: 'bg-emerald-50 text-emerald-600 border border-emerald-200' },
  pausado:  { label: 'Pausado',  cls: 'bg-amber-50 text-amber-600 border border-amber-200' },
  encerrado:{ label: 'Encerrado',cls: 'bg-red-50 text-red-500 border border-red-200' },
}

const STATUS_RESULT: Record<string, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',  cls: 'bg-amber-50 text-amber-600 border border-amber-200' },
  aprovado:  { label: 'Aprovado',  cls: 'bg-blue-50 text-blue-600 border border-blue-200' },
  pago:      { label: 'Pago',      cls: 'bg-emerald-50 text-emerald-600 border border-emerald-200' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-50 text-red-500 border border-red-200' },
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtData(d?: string) { if (!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') }
function fmtPct(v: number) { return `${v.toFixed(1)}%` }

function BarProgresso({ pct, cor = 'bg-blue-500' }: { pct: number; cor?: string }) {
  const p = Math.min(100, Math.max(0, pct))
  const barCor = p >= 100 ? 'bg-emerald-500' : p >= 80 ? 'bg-blue-500' : p >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${barCor}`} style={{ width: `${p}%` }} />
    </div>
  )
}

export default function IncentivoClient({ planos: init, vendedores, resultados, historico, empresaId, role, stats }: Props) {
  const sb = createClient()
  const [planos, setPlanos] = useState<Plano[]>(init)
  const [aba, setAba] = useState<'planos' | 'ranking' | 'apuracao'>('planos')
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Plano | null>(null)
  const [resultadosState, setResultadosState] = useState<Resultado[]>(resultados)
  const [salvandoStatus, setSalvandoStatus] = useState<string | null>(null)

  const planosFiltrados = useMemo(() => {
    let l = planos
    if (busca) l = l.filter(p => p.nome.toLowerCase().includes(busca.toLowerCase()))
    if (filtroTipo) l = l.filter(p => p.tipo === filtroTipo)
    if (filtroStatus) l = l.filter(p => p.status === filtroStatus)
    return l
  }, [planos, busca, filtroTipo, filtroStatus])

  function aoSalvar(plano: Plano) {
    setPlanos(prev => {
      const idx = prev.findIndex(p => p.id === plano.id)
      if (idx >= 0) { const c = [...prev]; c[idx] = plano; return c }
      return [plano, ...prev]
    })
    setModalAberto(false)
  }

  async function alterarStatusResultado(id: string, novoStatus: string) {
    setSalvandoStatus(id)
    const patch: Record<string, any> = { status: novoStatus, updated_at: new Date().toISOString() }
    if (novoStatus === 'aprovado') patch.aprovado_em = new Date().toISOString()
    if (novoStatus === 'pago') patch.pago_em = new Date().toISOString()
    await sb.from('incentivo_resultados').update(patch).eq('id', id)
    setResultadosState(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    setSalvandoStatus(null)
  }

  // Ranking: agrupa resultados por vendedor, soma comissão + bônus
  const rankingData = useMemo(() => {
    const map = new Map<string, { nome: string; apelido?: string; comissao: number; bonus: number; vendido: number; metaPct: number; }>()
    resultadosState.forEach(r => {
      if (!r.vendedores) return
      const chave = r.vendedor_id
      const prev  = map.get(chave) ?? { nome: r.vendedores.nome, apelido: r.vendedores.apelido, comissao: 0, bonus: 0, vendido: 0, metaPct: 0 }
      map.set(chave, {
        nome: prev.nome, apelido: prev.apelido,
        comissao: prev.comissao + (r.comissao_calculada ?? 0),
        bonus: prev.bonus + (r.bonus_calculado ?? 0),
        vendido: prev.vendido + (r.valor_vendido ?? 0),
        metaPct: Math.max(prev.metaPct, r.percentual_meta ?? 0),
      })
    })
    return [...map.entries()]
      .map(([id, d]) => ({ id, ...d, total: d.comissao + d.bonus }))
      .sort((a, b) => b.total - a.total)
  }, [resultadosState])

  const ABAS = [
    { key: 'planos' as const,    label: 'Planos',   icon: '📋' },
    { key: 'ranking' as const,   label: 'Ranking',  icon: '🏆' },
    { key: 'apuracao' as const,  label: 'Apuração', icon: '💳' },
  ]

  const POSICAO_ICONS = ['🥇', '🥈', '🥉']

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-slate-900 text-2xl font-bold">Incentivos Comerciais</h1>
            <p className="text-slate-500 text-sm mt-0.5">Campanhas, metas, comissões e premiações para a equipe de vendas</p>
          </div>
          <button
            onClick={() => { setEditando(null); setModalAberto(true) }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
          >
            <span className="text-base leading-none">+</span>
            Novo Plano
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Planos ativos',     value: stats.planosAtivos,  icon: '🔥', color: 'text-orange-600' },
            { label: 'Vendedores ativos', value: stats.participantes, icon: '👤', color: 'text-blue-600' },
            { label: 'Comissão pendente', value: fmt(stats.pendente), icon: '💰', color: 'text-amber-600', isStr: true },
          ].map(s => (
            <div key={s.label} className="bg-white border border-slate-100 rounded-2xl shadow-sm px-6 py-4 flex items-center gap-4">
              <span className="text-2xl">{s.icon}</span>
              <div>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-slate-500 text-xs">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex border-b border-slate-100 bg-slate-50 px-4">
            {ABAS.map(a => (
              <button key={a.key} onClick={() => setAba(a.key)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${aba === a.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                {a.icon} {a.label}
              </button>
            ))}
          </div>

          {/* ── ABA PLANOS ─────────────────────────────────────── */}
          {aba === 'planos' && (
            <div className="p-6">
              {/* Filtros */}
              <div className="flex gap-3 flex-wrap items-center mb-5">
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar plano…"
                  className="flex-1 min-w-[200px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400" />
                <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-700 focus:outline-none focus:border-blue-400">
                  <option value="">Todos os tipos</option>
                  {Object.entries(TIPO_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
                <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-700 focus:outline-none focus:border-blue-400">
                  <option value="">Todos os status</option>
                  {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                {(busca || filtroTipo || filtroStatus) && (
                  <button onClick={() => { setBusca(''); setFiltroTipo(''); setFiltroStatus('') }}
                    className="text-sm text-slate-400 hover:text-slate-600 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors">Limpar</button>
                )}
                <span className="ml-auto text-xs text-slate-400">{planosFiltrados.length} plano{planosFiltrados.length !== 1 ? 's' : ''}</span>
              </div>

              {planosFiltrados.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-300">
                  <span className="text-5xl mb-4">🏆</span>
                  <p className="text-sm font-medium text-slate-400">Nenhum plano encontrado</p>
                  <p className="text-xs text-slate-300 mt-1">Crie seu primeiro plano de incentivo</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {planosFiltrados.map(p => {
                    const t  = TIPO_CFG[p.tipo] ?? TIPO_CFG.comissao
                    const st = STATUS_CFG[p.status] ?? STATUS_CFG.rascunho
                    const nPart = p.incentivo_participantes?.filter(x => !x.todos_vendedores).length ?? 0
                    const todosV = p.incentivo_participantes?.some(x => x.todos_vendedores) ?? false
                    const nRegras = p.incentivo_regras?.filter(r => r.ativo).length ?? 0
                    return (
                      <div key={p.id} className={`border rounded-2xl p-5 hover:shadow-md transition-shadow cursor-pointer ${t.bg}`}
                        onClick={() => { setEditando(p); setModalAberto(true) }}>
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{p.icone || t.icon}</span>
                            <div>
                              <p className={`font-semibold text-sm ${t.cor}`}>{p.nome}</p>
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${t.bg} ${t.cor} border border-current/20`}>{t.label}</span>
                            </div>
                          </div>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        </div>

                        {(p.vigencia_inicio || p.vigencia_fim) && (
                          <p className="text-xs text-slate-500 mb-2">
                            📅 {fmtData(p.vigencia_inicio)} → {fmtData(p.vigencia_fim)}
                          </p>
                        )}

                        <div className="flex gap-3 text-xs text-slate-500 mt-3 pt-3 border-t border-white/60">
                          <span>{nRegras} regra{nRegras !== 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span>{todosV ? 'Todos os vendedores' : `${nPart} vendedor${nPart !== 1 ? 'es' : ''}`}</span>
                          {p.incentivo_metas?.length > 0 && <><span>·</span><span>🎯 {p.incentivo_metas.length} meta{p.incentivo_metas.length !== 1 ? 's' : ''}</span></>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── ABA RANKING ───────────────────────────────────── */}
          {aba === 'ranking' && (
            <div className="p-6">
              {rankingData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-300">
                  <span className="text-5xl mb-4">🏆</span>
                  <p className="text-sm font-medium text-slate-400">Sem dados de ranking</p>
                  <p className="text-xs text-slate-300 mt-1">O ranking é populado após a primeira apuração de resultados</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {rankingData.map((r, i) => (
                    <div key={r.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${i === 0 ? 'bg-amber-50 border-amber-200' : i === 1 ? 'bg-slate-50 border-slate-200' : i === 2 ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100'}`}>
                      <div className="text-2xl w-10 text-center flex-shrink-0">
                        {i < 3 ? POSICAO_ICONS[i] : <span className="text-slate-400 text-base font-bold">{i + 1}º</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm">{r.nome}</p>
                        {r.apelido && <p className="text-xs text-slate-400">{r.apelido}</p>}
                        <div className="flex items-center gap-3 mt-2">
                          <BarProgresso pct={r.metaPct} />
                          <span className="text-xs text-slate-500 flex-shrink-0 w-10 text-right">{fmtPct(r.metaPct)}</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-slate-400">Vendas</p>
                        <p className="text-sm font-medium text-slate-700">{fmt(r.vendido)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-slate-400">Comissão</p>
                        <p className="text-sm font-bold text-emerald-600">{fmt(r.comissao)}</p>
                      </div>
                      {r.bonus > 0 && (
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-slate-400">Bônus</p>
                          <p className="text-sm font-bold text-purple-600">{fmt(r.bonus)}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── ABA APURAÇÃO ──────────────────────────────────── */}
          {aba === 'apuracao' && (
            <div className="p-6">
              {resultadosState.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-300">
                  <span className="text-5xl mb-4">💳</span>
                  <p className="text-sm font-medium text-slate-400">Sem apurações registradas</p>
                  <p className="text-xs text-slate-300 mt-1">As apurações são geradas após o período de cada plano</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      {['Vendedor', 'Período', 'Vendas', 'Base', 'Comissão', 'Bônus', 'Status', 'Ações'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {resultadosState.map(r => {
                      const st = STATUS_RESULT[r.status] ?? STATUS_RESULT.pendente
                      const totalR = (r.comissao_calculada ?? 0) + (r.bonus_calculado ?? 0)
                      return (
                        <tr key={r.id} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-slate-800">{r.vendedores?.nome ?? '—'}</p>
                            {r.vendedores?.apelido && <p className="text-xs text-slate-400">{r.vendedores.apelido}</p>}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {fmtData(r.periodo_inicio)}<br />{fmtData(r.periodo_fim)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">{fmt(r.valor_vendido ?? 0)}</td>
                          <td className="px-4 py-3 text-sm text-slate-700">{fmt(r.valor_base_comissao ?? 0)}</td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-semibold text-emerald-600">{fmt(r.comissao_calculada ?? 0)}</p>
                            <div className="mt-1"><BarProgresso pct={r.percentual_meta ?? 0} /></div>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-purple-600">{fmt(r.bonus_calculado ?? 0)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              {r.status === 'pendente' && (
                                <button onClick={() => alterarStatusResultado(r.id, 'aprovado')}
                                  disabled={salvandoStatus === r.id}
                                  className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50">
                                  Aprovar
                                </button>
                              )}
                              {r.status === 'aprovado' && (
                                <button onClick={() => alterarStatusResultado(r.id, 'pago')}
                                  disabled={salvandoStatus === r.id}
                                  className="text-xs text-emerald-600 hover:text-emerald-800 font-medium px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-50">
                                  Pagar {fmt(totalR)}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {modalAberto && (
        <PlanoModal
          plano={editando}
          vendedores={vendedores}
          empresaId={empresaId}
          onSalvar={aoSalvar}
          onFechar={() => setModalAberto(false)}
        />
      )}
    </div>
  )
}
