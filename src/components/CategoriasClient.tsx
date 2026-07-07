'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Categoria = { id: string; nome: string; pai_id: string | null; ativo: boolean; created_at: string }

export default function CategoriasClient({ categorias: inicial, empresaId }: { categorias: Categoria[]; empresaId: string }) {
  const router = useRouter()
  const [categorias, setCategorias] = useState(inicial)
  const [novoNome, setNovoNome] = useState('')
  const [novoPai, setNovoPai] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [editando, setEditando] = useState<Categoria | null>(null)
  const [editNome, setEditNome] = useState('')
  const [erro, setErro] = useState('')

  const raizes = categorias.filter(c => !c.pai_id)
  const subs = categorias.filter(c => !!c.pai_id)

  async function adicionar() {
    if (!novoNome.trim()) return
    setErro('')
    setSalvando(true)
    const sb = createClient()
    const { data, error } = await sb.from('categorias').insert({
      empresa_id: empresaId || null,
      nome: novoNome.trim(),
      pai_id: novoPai || null,
      ativo: true,
    }).select().single()
    setSalvando(false)
    if (error) { setErro(`Erro: ${error.message}`); return }
    if (data) setCategorias(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)))
    setNovoNome(''); setNovoPai('')
  }

  async function toggleAtivo(cat: Categoria) {
    const sb = createClient()
    await sb.from('categorias').update({ ativo: !cat.ativo }).eq('id', cat.id)
    setCategorias(prev => prev.map(c => c.id === cat.id ? { ...c, ativo: !c.ativo } : c))
  }

  async function salvarEdicao() {
    if (!editando || !editNome.trim()) return
    const sb = createClient()
    await sb.from('categorias').update({ nome: editNome.trim() }).eq('id', editando.id)
    setCategorias(prev => prev.map(c => c.id === editando.id ? { ...c, nome: editNome } : c))
    setEditando(null)
  }

  async function excluir(id: string) {
    if (!confirm('Excluir esta categoria?')) return
    const sb = createClient()
    await sb.from('categorias').delete().eq('id', id)
    setCategorias(prev => prev.filter(c => c.id !== id))
  }

  function nomePai(paiId: string | null) {
    if (!paiId) return null
    return categorias.find(c => c.id === paiId)?.nome ?? null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
            <span>início</span><span>›</span><span>cadastros</span><span>›</span>
            <span className="text-gray-600 font-medium">categorias</span>
          </div>
          <h1 className="text-gray-900 text-xl font-semibold">Categorias</h1>
        </div>
      </div>

      {/* Adicionar */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Nova categoria / subcategoria</h2>
        <div className="flex gap-3">
          <input
            value={novoNome}
            onChange={e => setNovoNome(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionar()}
            placeholder="Nome da categoria"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
          />
          <select value={novoPai} onChange={e => setNovoPai(e.target.value)}
            className="w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
            <option value="">Categoria raiz</option>
            {raizes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <button onClick={adicionar} disabled={salvando || !novoNome.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? '...' : '+ Adicionar'}
          </button>
        </div>
        {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      </div>

      {/* Lista */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nome</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Subcategoria de</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Subcategorias</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Ativo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categorias.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors group">
                <td className="px-4 py-3 text-gray-900 font-medium">
                  {editando?.id === c.id ? (
                    <div className="flex gap-2">
                      <input value={editNome} onChange={e => setEditNome(e.target.value)}
                        className="border border-blue-400 rounded px-2 py-1 text-sm focus:outline-none" autoFocus />
                      <button onClick={salvarEdicao} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Salvar</button>
                      <button onClick={() => setEditando(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                    </div>
                  ) : (
                    <span className={!c.pai_id ? 'font-semibold' : 'pl-4 text-gray-700'}>
                      {!c.pai_id ? '' : '↳ '}{c.nome}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{nomePai(c.pai_id) ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {!c.pai_id ? `${subs.filter(s => s.pai_id === c.id).length} subcategoria(s)` : '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleAtivo(c)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${c.ativo ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${c.ativo ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditando(c); setEditNome(c.nome) }}
                      className="text-xs text-blue-600 hover:text-blue-800">Editar</button>
                    <button onClick={() => excluir(c.id)}
                      className="text-xs text-red-500 hover:text-red-700">Excluir</button>
                  </div>
                </td>
              </tr>
            ))}
            {categorias.length === 0 && (
              <tr><td colSpan={5} className="py-10 text-center text-gray-400">Nenhuma categoria cadastrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
