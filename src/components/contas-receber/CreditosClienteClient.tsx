'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

type Credito = {
  id: string; cliente_id: string; valor_original: number; valor_utilizado: number
  saldo_disponivel: number; origem: string; descricao: string | null; validade: string | null
  status: string; observacao: string | null; operador_nome: string | null; created_at: string
  clientes: { nome: string; telefone: string | null; cpf_cnpj: string | null } | null
}
type Cliente = { id: string; nome: string; cpf_cnpj: string | null; telefone: string | null; saldo_credito: number }
type Utilizacao = {
  id: string; credito_id: string; cliente_id: string; valor: number; descricao: string | null
  operador: string | null; created_at: string
}

const ORIGENS: Record<string,string> = {
  troca:'Troca', devolucao:'Devolução', adiantamento:'Adiantamento',
  ajuste:'Ajuste Manual', pagamento_excedente:'Pagamento Excedente', manual:'Manual'
}
const STATUS_COLOR: Record<string,string> = {
  disponivel: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
  parcial:    'bg-amber-50 text-amber-600 border border-amber-100',
  utilizado:  'bg-slate-100 text-slate-500',
  cancelado:  'bg-red-50 text-red-600 border border-red-100',
  expirado:   'bg-orange-50 text-orange-600 border border-orange-100',
}

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDt(d: string) { const [y,m,dia] = d.split('T')[0].split('-'); return `${dia}/${m}/${y}` }

export default function CreditosClienteClient({
  empresaId, operador, creditosIniciais, clientes, utilizacoesIniciais
}: {
  empresaId: string; operador: string; creditosIniciais: Credito[]
  clientes: Cliente[]; utilizacoesIniciais: Utilizacao[]
}) {
  const sb = createClient()
  const [creditos, setCreditos] = useState<Credito[]>(creditosIniciais)
  const [utilizacoes] = useState<Utilizacao[]>(utilizacoesIniciais)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [busca, setBusca] = useState('')
  const [modalNovo, setModalNovo] = useState(false)
  const [novo, setNovo] = useState({ cliente_id:'', valor:'', origem:'manual', descricao:'', validade:'', observacao:'' })
  const [salvando, setSalvando] = useState(false)
  const [detalhe, setDetalhe] = useState<Credito | null>(null)

  const creditosFiltrados = useMemo(() => {
    let list = [...creditos]
    if (filtroStatus !== 'todos') list = list.filter(c => c.status === filtroStatus)
    if (busca) {
      const b = busca.toLowerCase()
      list = list.filter(c => (c.clientes?.nome ?? '').toLowerCase().includes(b) || (c.descricao ?? '').toLowerCase().includes(b))
    }
    return list
  }, [creditos, filtroStatus, busca])

  const totalDisponivel = creditos.filter(c => ['disponivel','parcial'].includes(c.status)).reduce((s,c) => s + c.saldo_disponivel, 0)
  const totalGerado     = creditos.reduce((s,c) => s + c.valor_original, 0)
  const totalUtilizado  = creditos.reduce((s,c) => s + c.valor_utilizado, 0)

  async function salvarCredito() {
    const cli = clientes.find(c => c.id === novo.cliente_id)
    if (!cli || !novo.valor) { alert('Selecione o cliente e informe o valor'); return }
    setSalvando(true)
    try {
      const valor = parseFloat(novo.valor.replace(',','.'))
      const { data, error } = await sb.from('creditos_cliente').insert({
        empresa_id: empresaId, cliente_id: novo.cliente_id, valor_original: valor, valor_utilizado: 0,
        origem: novo.origem, descricao: novo.descricao || null, validade: novo.validade || null,
        status: 'disponivel', observacao: novo.observacao || null, operador_nome: operador,
      }).select('*, clientes(nome, telefone, cpf_cnpj)').single()
      if (error) throw error
      await sb.from('clientes').update({ saldo_credito: (cli.saldo_credito ?? 0) + valor }).eq('id', novo.cliente_id)
      setCreditos(p => [data as Credito, ...p])
      setModalNovo(false)
      setNovo({ cliente_id:'', valor:'', origem:'manual', descricao:'', validade:'', observacao:'' })
    } catch(e:any) { alert('Erro: ' + e.message) }
    finally { setSalvando(false) }
  }

  async function cancelarCredito(id: string) {
    if (!confirm('Cancelar este crédito?')) return
    await sb.from('creditos_cliente').update({ status: 'cancelado', updated_at: new Date().toISOString() }).eq('id', id)
    setCreditos(p => p.map(c => c.id === id ? { ...c, status: 'cancelado' } : c))
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-900 text-xl font-bold">Créditos de Clientes</h1>
          <p className="text-slate-500 text-sm mt-0.5">{creditosFiltrados.length} registro(s)</p>
        </div>
        <button onClick={() => setModalNovo(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors">
          + Novo Crédito
        </button>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Saldo Disponível', valor: totalDisponivel,  cor: 'text-emerald-600', icon: '🎫', bg: 'linear-gradient(135deg,#ecfdf5,#f0fdfa)' },
          { label: 'Total Gerado',     valor: totalGerado,      cor: 'text-blue-600',    icon: '📈', bg: 'linear-gradient(135deg,#eff6ff,#eef2ff)' },
          { label: 'Total Utilizado',  valor: totalUtilizado,   cor: 'text-amber-600',   icon: '💳', bg: 'linear-gradient(135deg,#fffbeb,#fff7ed)' },
        ].map(m => (
          <div key={m.label} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-2xl" style={{ background: m.bg, borderRadius: '10px', padding: '6px 8px' }}>{m.icon}</span>
            </div>
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">{m.label}</p>
            <p className={`text-xl font-bold mt-1 ${m.cor}`}>{fmt(m.valor)}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar cliente..."
          className="bg-white border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm w-56 focus:outline-none focus:border-blue-400 placeholder-slate-400 shadow-sm" />
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 rounded-xl px-3 py-2 text-sm shadow-sm">
          <option value="todos">Todos</option>
          <option value="disponivel">Disponível</option>
          <option value="parcial">Parcial</option>
          <option value="utilizado">Utilizado</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left font-medium">Cliente</th>
              <th className="px-4 py-3 text-left font-medium">Origem</th>
              <th className="px-4 py-3 text-center font-medium">Gerado em</th>
              <th className="px-4 py-3 text-center font-medium">Validade</th>
              <th className="px-4 py-3 text-right font-medium">Valor Original</th>
              <th className="px-4 py-3 text-right font-medium">Utilizado</th>
              <th className="px-4 py-3 text-right font-medium">Saldo</th>
              <th className="px-4 py-3 text-center font-medium">Status</th>
              <th className="px-4 py-3 text-center font-medium">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {creditosFiltrados.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-slate-400">Nenhum crédito encontrado</td></tr>
            )}
            {creditosFiltrados.map(c => (
              <tr key={c.id} className="text-slate-700 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-slate-800 font-medium">{c.clientes?.nome ?? '—'}</p>
                  <p className="text-slate-400 text-xs">{c.clientes?.telefone ?? ''}</p>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{ORIGENS[c.origem] ?? c.origem}</td>
                <td className="px-4 py-3 text-center text-slate-500 text-xs">{fmtDt(c.created_at)}</td>
                <td className="px-4 py-3 text-center text-slate-500 text-xs">{c.validade ? fmtDt(c.validade) : '—'}</td>
                <td className="px-4 py-3 text-right text-slate-700">{fmt(c.valor_original)}</td>
                <td className="px-4 py-3 text-right text-amber-600">
                  {c.valor_utilizado > 0 ? fmt(c.valor_utilizado) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-bold text-emerald-600">
                  {c.saldo_disponivel > 0 ? fmt(c.saldo_disponivel) : '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR[c.status] ?? 'bg-slate-100 text-slate-500'}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setDetalhe(c)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs rounded-lg">
                      Detalhes
                    </button>
                    {['disponivel','parcial'].includes(c.status) && (
                      <button onClick={() => cancelarCredito(c.id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 text-xs rounded-lg">
                        ✕
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL NOVO CRÉDITO */}
      {modalNovo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">Novo Crédito de Cliente</h2>
              <button onClick={() => setModalNovo(false)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-slate-500 text-xs font-medium">Cliente *</label>
                <select value={novo.cliente_id} onChange={e => setNovo(p=>({...p, cliente_id:e.target.value}))}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                  <option value="">Selecione o cliente</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-500 text-xs font-medium">Origem</label>
                  <select value={novo.origem} onChange={e => setNovo(p=>({...p, origem:e.target.value}))}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm">
                    {Object.entries(ORIGENS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 text-xs font-medium">Valor (R$) *</label>
                  <input value={novo.valor} onChange={e => setNovo(p=>({...p, valor:e.target.value}))}
                    placeholder="0,00"
                    className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-slate-500 text-xs font-medium">Descrição</label>
                <input value={novo.descricao} onChange={e => setNovo(p=>({...p, descricao:e.target.value}))}
                  placeholder="Ex: Devolução produto X"
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-slate-500 text-xs font-medium">Validade (opcional)</label>
                <input type="date" value={novo.validade} onChange={e => setNovo(p=>({...p, validade:e.target.value}))}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-slate-500 text-xs font-medium">Observação</label>
                <input value={novo.observacao} onChange={e => setNovo(p=>({...p, observacao:e.target.value}))}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModalNovo(false)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Cancelar</button>
              <button onClick={salvarCredito} disabled={salvando}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Salvar Crédito'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALHE */}
      {detalhe && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold">Crédito — {detalhe.clientes?.nome}</h2>
              <button onClick={() => setDetalhe(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                  <p className="text-slate-500 text-xs">Valor Original</p>
                  <p className="text-slate-800 font-bold mt-0.5">{fmt(detalhe.valor_original)}</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                  <p className="text-amber-600 text-xs">Utilizado</p>
                  <p className="text-amber-700 font-bold mt-0.5">{fmt(detalhe.valor_utilizado)}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <p className="text-emerald-600 text-xs">Saldo</p>
                  <p className="text-emerald-700 font-bold mt-0.5">{fmt(detalhe.saldo_disponivel)}</p>
                </div>
              </div>
              <div className="text-xs text-slate-500 space-y-1.5">
                <p>Origem: <span className="text-slate-700 font-medium">{ORIGENS[detalhe.origem] ?? detalhe.origem}</span></p>
                {detalhe.descricao && <p>Descrição: <span className="text-slate-700">{detalhe.descricao}</span></p>}
                {detalhe.validade && <p>Validade: <span className="text-slate-700">{fmtDt(detalhe.validade)}</span></p>}
                <p>Gerado em: <span className="text-slate-700">{fmtDt(detalhe.created_at)}</span></p>
                {detalhe.operador_nome && <p>Operador: <span className="text-slate-700">{detalhe.operador_nome}</span></p>}
              </div>
              {utilizacoes.filter(u => u.credito_id === detalhe.id).length > 0 && (
                <div>
                  <p className="text-slate-600 text-xs font-semibold uppercase tracking-wide mb-2">Utilizações</p>
                  <div className="space-y-1">
                    {utilizacoes.filter(u => u.credito_id === detalhe.id).map(u => (
                      <div key={u.id} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs">
                        <span className="text-slate-500">{fmtDt(u.created_at)} · {u.descricao ?? 'Uso'}</span>
                        <span className="text-amber-600 font-semibold">- {fmt(u.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end px-5 py-4 border-t border-slate-100">
              <button onClick={() => setDetalhe(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm hover:bg-slate-200">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
