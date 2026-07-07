'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const TIPOS = [
  { value: 'geral',        label: 'Inventário Geral' },
  { value: 'parcial',      label: 'Inventário Parcial' },
  { value: 'categoria',    label: 'Por Categoria' },
  { value: 'subcategoria', label: 'Por Subcategoria' },
  { value: 'marca',        label: 'Por Marca' },
  { value: 'entrada',      label: 'Por Entrada de Mercadoria' },
  { value: 'manual',       label: 'Manual' },
]

const STATUS: Record<string, { label: string; cor: string }> = {
  aberto:       { label: 'Aberto',       cor: 'bg-blue-100 text-blue-700' },
  em_contagem:  { label: 'Em Contagem',  cor: 'bg-yellow-100 text-yellow-700' },
  finalizado:   { label: 'Finalizado',   cor: 'bg-green-100 text-green-700' },
  cancelado:    { label: 'Cancelado',    cor: 'bg-red-100 text-red-600' },
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('pt-BR')
}

type Inventario = {
  id: string; numero: number; descricao: string; tipo: string; status: string
  deposito_nome: string | null; responsavel: string | null
  data_abertura: string; data_finalizacao: string | null
  total_itens: number; itens_contados: number; itens_divergentes: number
  created_at: string
}
type Deposito = { id: string; nome: string }
type Cat = { id: string; nome: string }

export default function InventariosClient({ empresaId, operador, inventarios: ini, depositos, categorias, marcas }: {
  empresaId: string; operador: string
  inventarios: Inventario[]; depositos: Deposito[]
  categorias: Cat[]; marcas: Cat[]
}) {
  const sb = createClient()
  const router = useRouter()
  const [lista, setLista] = useState<Inventario[]>(ini)
  const [modalNovo, setModalNovo] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroBusca, setFiltroBusca] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Form novo inventário
  const [form, setForm] = useState({
    descricao: '', tipo: 'geral', deposito_id: depositos[0]?.id ?? '',
    deposito_nome: depositos[0]?.nome ?? 'Principal',
    responsavel: operador.split('@')[0], observacao: '',
    data_abertura: new Date().toISOString().slice(0, 10),
  })

  const filtrado = lista.filter(i => {
    const matchS = filtroStatus === 'todos' || i.status === filtroStatus
    const q = filtroBusca.toLowerCase()
    const matchB = !q || String(i.numero).includes(q) || i.descricao.toLowerCase().includes(q) || (i.responsavel ?? '').toLowerCase().includes(q)
    return matchS && matchB
  })

  async function criar() {
    if (!form.descricao.trim()) return
    setSalvando(true)
    const dep = depositos.find(d => d.id === form.deposito_id)
    const { data, error } = await sb.from('inventarios').insert({
      empresa_id: empresaId,
      deposito_id: form.deposito_id || null,
      deposito_nome: dep?.nome ?? form.deposito_nome,
      descricao: form.descricao,
      tipo: form.tipo,
      responsavel: form.responsavel,
      observacao: form.observacao || null,
      data_abertura: form.data_abertura,
      status: 'aberto',
      criado_por: operador,
    }).select().single()
    if (!error && data) {
      await sb.from('inventario_historico').insert({
        inventario_id: data.id, acao: 'criado',
        descricao: `Inventário criado por ${operador}`, usuario: operador,
      })
      router.push(`/dashboard/inventarios/${data.id}`)
    }
    setSalvando(false)
  }

  const progressoColor = (inv: Inventario) => {
    if (inv.total_itens === 0) return 'bg-gray-200'
    const pct = inv.itens_contados / inv.total_itens
    if (pct >= 1) return 'bg-green-500'
    if (pct >= 0.5) return 'bg-yellow-400'
    return 'bg-blue-400'
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventários de Estoque</h1>
          <p className="text-sm text-gray-500 mt-0.5">Controle de contagem e ajuste de estoque</p>
        </div>
        <button onClick={() => setModalNovo(true)}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm flex items-center gap-2">
          + Novo Inventário
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <input value={filtroBusca} onChange={e => setFiltroBusca(e.target.value)}
          placeholder="Buscar por número, descrição..."
          className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400 w-72" />
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {['todos', 'aberto', 'em_contagem', 'finalizado', 'cancelado'].map(s => (
            <button key={s} onClick={() => setFiltroStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filtroStatus === s ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {s === 'todos' ? 'Todos' : STATUS[s]?.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      {filtrado.length === 0 ? (
        <div className="text-center py-20 text-gray-300">
          <div className="text-5xl mb-3">📦</div>
          <p className="text-sm">Nenhum inventário encontrado</p>
          <button onClick={() => setModalNovo(true)} className="mt-4 text-blue-600 text-sm hover:underline">Criar primeiro inventário</button>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtrado.map(inv => {
            const pct = inv.total_itens > 0 ? Math.round((inv.itens_contados / inv.total_itens) * 100) : 0
            return (
              <div key={inv.id} onClick={() => router.push(`/dashboard/inventarios/${inv.id}`)}
                className="bg-white border border-gray-200 rounded-2xl p-5 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-xs font-mono text-gray-400">#{inv.numero}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS[inv.status]?.cor}`}>
                        {STATUS[inv.status]?.label}
                      </span>
                      <span className="text-xs text-gray-400">{TIPOS.find(t => t.value === inv.tipo)?.label}</span>
                    </div>
                    <p className="font-semibold text-gray-900 truncate">{inv.descricao}</p>
                    <div className="flex gap-4 mt-1 text-xs text-gray-400">
                      <span>📍 {inv.deposito_nome ?? 'Principal'}</span>
                      <span>👤 {inv.responsavel}</span>
                      <span>📅 {fmtDate(inv.data_abertura)}</span>
                      {inv.data_finalizacao && <span>✓ {fmtDate(inv.data_finalizacao)}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 w-40">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{inv.itens_contados}/{inv.total_itens} contados</span>
                      <span className="font-medium">{pct}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${progressoColor(inv)}`} style={{ width: `${pct}%` }} />
                    </div>
                    {inv.itens_divergentes > 0 && (
                      <p className="text-xs text-orange-600 font-medium mt-1">{inv.itens_divergentes} divergentes</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Novo Inventário */}
      {modalNovo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModalNovo(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="font-bold text-gray-900 text-lg">Novo Inventário</h2>
              <button onClick={() => setModalNovo(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Descrição *</label>
                <input autoFocus value={form.descricao} onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))}
                  placeholder="Ex: Inventário geral agosto 2025"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Tipo</label>
                  <select value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500">
                    {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Depósito</label>
                  <select value={form.deposito_id}
                    onChange={e => {
                      const dep = depositos.find(d => d.id === e.target.value)
                      setForm(p => ({ ...p, deposito_id: e.target.value, deposito_nome: dep?.nome ?? '' }))
                    }}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500">
                    {depositos.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Responsável</label>
                  <input value={form.responsavel} onChange={e => setForm(p => ({ ...p, responsavel: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Data de abertura</label>
                  <input type="date" value={form.data_abertura} onChange={e => setForm(p => ({ ...p, data_abertura: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Observação</label>
                <textarea value={form.observacao} onChange={e => setForm(p => ({ ...p, observacao: e.target.value }))}
                  rows={2} placeholder="Opcional..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button onClick={() => setModalNovo(false)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={criar} disabled={salvando || !form.descricao.trim()}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl text-sm">
                {salvando ? 'Criando...' : 'Criar Inventário →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
