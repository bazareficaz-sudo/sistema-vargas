'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import UsuarioPdvModal, { UsuarioPdv } from './UsuarioPdvModal'
import { contarPermissoesAtivas } from './permissoes'

interface Empresa {
  id: string
  nome: string
  nome_fantasia?: string
}

interface Deposito {
  id: string
  empresa_id: string
  nome: string
  principal?: boolean
}

interface Props {
  usuarios: UsuarioPdv[]
  empresas: Empresa[]
  depositos: Deposito[]
  empresaAtualId: string
  empresaAtualNome: string
  erroCarregamento?: string
}

export default function UsuariosPdvClient({ usuarios: inicial, empresas, depositos, empresaAtualId, empresaAtualNome, erroCarregamento }: Props) {
  const router = useRouter()
  const [usuarios, setUsuarios] = useState<UsuarioPdv[]>(inicial)
  useEffect(() => { setUsuarios(inicial) }, [inicial])

  const [busca, setBusca] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<UsuarioPdv | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!busca.trim()) return usuarios
    const q = busca.toLowerCase()
    return usuarios.filter(u => u.nome.toLowerCase().includes(q) || u.login.toLowerCase().includes(q))
  }, [usuarios, busca])

  function abrirNovo() {
    setEditando(null)
    setModalAberto(true)
  }

  function abrirEditar(u: UsuarioPdv) {
    setEditando(u)
    setModalAberto(true)
  }

  function aoSalvar(novo: UsuarioPdv) {
    setUsuarios(prev => {
      const idx = prev.findIndex(u => u.id === novo.id)
      if (idx >= 0) {
        const copia = [...prev]
        copia[idx] = novo
        return copia
      }
      return [novo, ...prev]
    })
    setModalAberto(false)
    router.refresh()
  }

  async function excluir(u: UsuarioPdv) {
    if (!confirm(`Remover o acesso de "${u.nome}"? Essa ação não pode ser desfeita.`)) return
    setExcluindo(u.id)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('usuarios_pdv').delete().eq('id', u.id)
      if (error) throw error
      setUsuarios(prev => prev.filter(x => x.id !== u.id))
    } catch (e: any) {
      alert(e?.message ?? 'Erro ao remover usuário.')
    } finally {
      setExcluindo(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-6 py-8">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-slate-900 text-2xl font-bold">Usuários do PDV</h1>
            <p className="text-slate-500 text-sm mt-0.5">Gerencie quem pode acessar o PDV externo — {empresaAtualNome}</p>
          </div>
          <button
            onClick={abrirNovo}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
          >
            <span className="text-base leading-none">+</span>
            Novo Usuário PDV
          </button>
        </div>

        {erroCarregamento && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
            Erro ao carregar usuários: {erroCarregamento}
          </div>
        )}

        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm px-6 py-4 mb-4 flex gap-3 flex-wrap items-center">
          <input
            type="text"
            placeholder="Buscar por nome ou login…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="flex-1 min-w-[220px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400"
          />
          <span className="ml-auto text-sm text-slate-400">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <span className="text-4xl mb-3">🔐</span>
              <p className="text-sm font-medium">Nenhum usuário de PDV cadastrado</p>
              <p className="text-xs mt-1">Clique em "Novo Usuário PDV" para cadastrar</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Usuário</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Login</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Permissões</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Status</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(u => {
                  const n = contarPermissoesAtivas(u.permissoes)
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-3">
                        <p className="text-sm font-semibold text-slate-800">{u.nome}</p>
                        {u.cargo && <p className="text-xs text-slate-400">{u.cargo}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-blue-600 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">{u.login}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full">
                          {n} permiss{n === 1 ? 'ão' : 'ões'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${u.ativo ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                          {u.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => abrirEditar(u)}
                            className="text-slate-400 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                            title="Editar"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => excluir(u)}
                            disabled={excluindo === u.id}
                            className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40"
                            title="Remover"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-100 rounded-2xl p-5">
          <p className="text-blue-700 text-sm font-semibold flex items-center gap-2">
            <span>🏷️</span> Acesso ao PDV
          </p>
          <p className="text-blue-600 text-sm mt-2">
            Os operadores acessam pelo <strong>aplicativo VargasNexus PDV</strong> instalado no terminal, usando o login e a senha cadastrados aqui.
          </p>
          <p className="text-blue-500 text-xs mt-1">
            O acesso é independente do login do painel principal — cada operador usa apenas o login e a senha cadastrados nesta tela.
          </p>
        </div>
      </div>

      {modalAberto && (
        <UsuarioPdvModal
          usuario={editando}
          empresas={empresas}
          depositos={depositos}
          empresaAtualId={empresaAtualId}
          onSalvar={aoSalvar}
          onFechar={() => setModalAberto(false)}
        />
      )}
    </div>
  )
}
