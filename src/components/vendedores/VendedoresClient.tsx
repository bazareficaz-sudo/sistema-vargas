'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import VendedorModal from './VendedorModal'

interface VendedorEmpresa {
  empresa_id: string
  empresa_principal: boolean
  pode_vender: boolean
  ativo: boolean
  empresas: { id: string; nome: string; nome_fantasia?: string } | null
}

interface Vendedor {
  id: string
  codigo?: string
  matricula?: string
  nome: string
  apelido?: string
  cpf?: string
  rg?: string
  telefone?: string
  whatsapp?: string
  email?: string
  data_nascimento?: string
  data_admissao?: string
  data_desligamento?: string
  status: string
  ativo: boolean
  participa_comissao: boolean
  tipo_remuneracao: string
  obs_comissao?: string
  permite_todas_empresas: boolean
  permite_login: boolean
  obs?: string
  empresa_id: string
  user_id?: string
  identificador_externo?: string
  created_at?: string
  vendedor_empresas: VendedorEmpresa[]
}

interface Empresa {
  id: string
  nome: string
  nome_fantasia?: string
}

interface Props {
  vendedores: Vendedor[]
  empresas: Empresa[]
  empresaAtualId: string
  total: number
  ativos: number
  comissionados: number
  role: string
  erroCarregamento?: string
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  ativo:      { label: 'Ativo',      cls: 'bg-emerald-50 text-emerald-600 border border-emerald-100' },
  inativo:    { label: 'Inativo',    cls: 'bg-slate-100 text-slate-500 border border-slate-200' },
  desligado:  { label: 'Desligado', cls: 'bg-red-50 text-red-600 border border-red-100' },
  bloqueado:  { label: 'Bloqueado', cls: 'bg-amber-50 text-amber-600 border border-amber-100' },
}

function formatCPF(cpf?: string) {
  if (!cpf) return ''
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

function formatTelefone(t?: string) {
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return t
}

export default function VendedoresClient({ vendedores: inicial, empresas, empresaAtualId, total, ativos, comissionados, erroCarregamento }: Props) {
  const router = useRouter()
  const [vendedores, setVendedores] = useState<Vendedor[]>(inicial)
  const [busca, setBusca] = useState('')

  // Sincroniza quando o servidor re-renderiza com dados atualizados
  useEffect(() => { setVendedores(inicial) }, [inicial])
  const [filtroStatus, setFiltroStatus] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Vendedor | null>(null)

  const filtered = useMemo(() => {
    let list = vendedores
    if (busca.trim()) {
      const q = busca.toLowerCase()
      list = list.filter(v =>
        v.nome.toLowerCase().includes(q) ||
        (v.apelido ?? '').toLowerCase().includes(q) ||
        (v.codigo ?? '').toLowerCase().includes(q) ||
        (v.cpf ?? '').includes(q) ||
        (v.email ?? '').toLowerCase().includes(q)
      )
    }
    if (filtroStatus) {
      list = list.filter(v => v.status === filtroStatus)
    }
    return list
  }, [vendedores, busca, filtroStatus])

  function abrirNovo() {
    setEditando(null)
    setModalAberto(true)
  }

  function abrirEditar(v: Vendedor) {
    setEditando(v)
    setModalAberto(true)
  }

  function aoSalvar(novo: Vendedor) {
    // Atualização otimista: aparece imediatamente na tela
    setVendedores(prev => {
      const idx = prev.findIndex(v => v.id === novo.id)
      if (idx >= 0) {
        const copia = [...prev]
        copia[idx] = novo
        return copia
      }
      return [novo, ...prev]
    })
    setModalAberto(false)
    // Sincroniza com o banco para garantir consistência
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-slate-900 text-2xl font-bold">Vendedores</h1>
            <p className="text-slate-500 text-sm mt-0.5">Equipe comercial vinculada à empresa</p>
          </div>
          <button
            onClick={abrirNovo}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
          >
            <span className="text-base leading-none">+</span>
            Novo Vendedor
          </button>
        </div>

        {erroCarregamento && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
            Erro ao carregar vendedores: {erroCarregamento}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total',         value: total,        icon: '👤', color: 'text-slate-700' },
            { label: 'Ativos',        value: ativos,       icon: '✅', color: 'text-emerald-600' },
            { label: 'Comissionados', value: comissionados, icon: '💲', color: 'text-blue-600' },
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

        {/* Filtros */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm px-6 py-4 mb-4 flex gap-3 flex-wrap items-center">
          <input
            type="text"
            placeholder="Buscar por nome, CPF, código…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="flex-1 min-w-[220px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400"
          />
          <select
            value={filtroStatus}
            onChange={e => setFiltroStatus(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400"
          >
            <option value="">Todos os status</option>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
            <option value="desligado">Desligado</option>
            <option value="bloqueado">Bloqueado</option>
          </select>
          {(busca || filtroStatus) && (
            <button
              onClick={() => { setBusca(''); setFiltroStatus('') }}
              className="text-sm text-slate-400 hover:text-slate-600 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
              Limpar
            </button>
          )}
          <span className="ml-auto text-sm text-slate-400">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Tabela */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <span className="text-4xl mb-3">👤</span>
              <p className="text-sm font-medium">Nenhum vendedor encontrado</p>
              <p className="text-xs mt-1">Clique em "Novo Vendedor" para cadastrar</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Código</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Vendedor</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Empresas</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Contato</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">CPF</th>
                  <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Comissão</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(v => {
                  const st = STATUS_CONFIG[v.status] ?? STATUS_CONFIG.inativo
                  const empresasVinculo = v.vendedor_empresas?.filter(ve => ve.ativo) ?? []
                  return (
                    <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-3">
                        <div className="flex flex-col gap-0.5">
                          {v.codigo && (
                            <span className="text-xs font-mono text-blue-600 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 w-fit">
                              {v.codigo}
                            </span>
                          )}
                          {v.matricula && (
                            <span className="text-xs text-slate-400">Mat. {v.matricula}</span>
                          )}
                          {!v.codigo && !v.matricula && (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-slate-800">{v.nome}</p>
                        {v.apelido && <p className="text-xs text-slate-400">{v.apelido}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[180px]">
                          {v.permite_todas_empresas ? (
                            <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full">
                              Todas
                            </span>
                          ) : empresasVinculo.length > 0 ? (
                            empresasVinculo.slice(0, 2).map(ve => (
                              <span key={ve.empresa_id} className={`text-xs px-2 py-0.5 rounded-full ${ve.empresa_principal ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                                {ve.empresas?.nome_fantasia ?? ve.empresas?.nome ?? '—'}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-300 text-xs">Sem vínculo</span>
                          )}
                          {!v.permite_todas_empresas && empresasVinculo.length > 2 && (
                            <span className="text-xs text-slate-400">+{empresasVinculo.length - 2}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          {v.telefone && <span className="text-xs text-slate-600">{formatTelefone(v.telefone)}</span>}
                          {v.whatsapp && !v.telefone && <span className="text-xs text-slate-600">{formatTelefone(v.whatsapp)}</span>}
                          {v.email && <span className="text-xs text-slate-400 truncate max-w-[160px]">{v.email}</span>}
                          {!v.telefone && !v.whatsapp && !v.email && <span className="text-slate-300 text-xs">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-500">{formatCPF(v.cpf) || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {v.participa_comissao ? (
                          <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded-full">Sim</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => abrirEditar(v)}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modalAberto && (
        <VendedorModal
          vendedor={editando}
          empresas={empresas}
          empresaAtualId={empresaAtualId}
          onSalvar={aoSalvar}
          onFechar={() => setModalAberto(false)}
        />
      )}
    </div>
  )
}
