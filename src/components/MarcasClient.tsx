'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Marca = { id: string; nome: string; ativo: boolean; created_at: string }

export default function MarcasClient({ marcas: inicial, empresaId }: { marcas: Marca[]; empresaId: string }) {
  const [marcas, setMarcas] = useState(inicial)
  const [novoNome, setNovoNome] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [editando, setEditando] = useState<Marca | null>(null)
  const [editNome, setEditNome] = useState('')
  const [busca, setBusca] = useState('')

  const filtradas = marcas.filter(m => m.nome.toLowerCase().includes(busca.toLowerCase()))

  async function adicionar() {
    if (!novoNome.trim()) return
    setSalvando(true)
    const sb = createClient()
    const { data } = await sb.from('marcas').insert({
      empresa_id: empresaId, nome: novoNome.trim(), ativo: true,
    }).select().single()
    if (data) setMarcas(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
    setNovoNome(''); setSalvando(false)
  }

  async function toggleAtivo(marca: Marca) {
    const sb = createClient()
    await sb.from('marcas').update({ ativo: !marca.ativo }).eq('id', marca.id)
    setMarcas(prev => prev.map(m => m.id === marca.id ? { ...m, ativo: !m.ativo } : m))
  }

  async function salvarEdicao() {
    if (!editando || !editNome.trim()) return
    const sb = createClient()
    await sb.from('marcas').update({ nome: editNome.trim() }).eq('id', editando.id)
    setMarcas(prev => prev.map(m => m.id === editando.id ? { ...m, nome: editNome } : m))
    setEditando(null)
  }

  async function excluir(id: string) {
    if (!confirm('Excluir esta marca?')) return
    const sb = createClient()
    await sb.from('marcas').delete().eq('id', id)
    setMarcas(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
            <span>início</span><span>›</span><span>cadastros</span><span>›</span>
            <span className="text-gray-600 font-medium">marcas</span>
          </div>
          <h1 className="text-gray-900 text-xl font-semibold">Marcas</h1>
          <p className="text-gray-500 text-sm mt-0.5">{marcas.length} marcas cadastradas</p>
        </div>
      </div>

      {/* Adicionar */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Nova marca</h2>
        <div className="flex gap-3">
          <input
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionar()}
            placeholder="Nome da marca"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
          />
          <button onClick={adicionar} disabled={salvando || !novoNome.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? '...' : '+ Adicionar'}
          </button>
        </div>
      </div>

      {/* Busca + Lista */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Filtrar marcas..."
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-blue-500 w-64"
          />
          <span className="text-xs text-gray-400">{filtradas.length} resultado(s)</span>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Cadastrada em</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Ativo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtradas.map(m => (
              <tr key={m.id} className="hover:bg-gray-50 transition-colors group">
                <td className="px-4 py-3 text-gray-900 font-medium">
                  {editando?.id === m.id ? (
                    <div className="flex gap-2">
                      <input value={editNome} onChange={e => setEditNome(e.target.value)}
                        className="border border-blue-400 rounded px-2 py-1 text-sm focus:outline-none" autoFocus />
                      <button onClick={salvarEdicao} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Salvar</button>
                      <button onClick={() => setEditando(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                    </div>
                  ) : m.nome}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {new Date(m.created_at).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleAtivo(m)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${m.ativo ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${m.ativo ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditando(m); setEditNome(m.nome) }}
                      className="text-xs text-blue-600 hover:text-blue-800">Editar</button>
                    <button onClick={() => excluir(m.id)}
                      className="text-xs text-red-500 hover:text-red-700">Excluir</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr><td colSpan={4} className="py-10 text-center text-gray-400">Nenhuma marca encontrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
