'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sincronizarProdutoVinculado } from '@/lib/produtos/vinculo'

const UNIDADES = ['UN', 'KG', 'LT', 'MT', 'CX', 'PC', 'PR', 'DZ', 'CT', 'M2', 'M3', 'GR', 'ML', 'CM']

type Categoria = { id: string; nome: string; pai_id: string | null }
type Marca = { id: string; nome: string }

export default function AcoesEmMassaModal({ ids, categoriasRaiz, categoriasTodas, marcas, onClose, onAplicado }: {
  ids: string[]
  categoriasRaiz: Categoria[]
  categoriasTodas: Categoria[]
  marcas: Marca[]
  onClose: () => void
  onAplicado: () => void
}) {
  const [aplicarCategoria, setAplicarCategoria] = useState(false)
  const [categoria, setCategoria] = useState('')
  const [subcategoria, setSubcategoria] = useState('')

  const [aplicarMarca, setAplicarMarca] = useState(false)
  const [marca, setMarca] = useState('')

  const [aplicarNcm, setAplicarNcm] = useState(false)
  const [ncm, setNcm] = useState('')

  const [aplicarUnidade, setAplicarUnidade] = useState(false)
  const [unidade, setUnidade] = useState('UN')

  const [aplicarPdv, setAplicarPdv] = useState(false)
  const [disponivelPdv, setDisponivelPdv] = useState(true)

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const subcategoriasDisponiveis = categoria
    ? categoriasTodas.filter(c => c.pai_id && categoriasTodas.find(r => r.id === c.pai_id)?.nome === categoria)
    : []

  const nenhumCampoSelecionado = !aplicarCategoria && !aplicarMarca && !aplicarNcm && !aplicarUnidade && !aplicarPdv

  async function aplicar() {
    if (nenhumCampoSelecionado) { setErro('Marque ao menos um campo para aplicar.'); return }
    setSalvando(true); setErro('')

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (aplicarCategoria) payload.categoria = subcategoria || categoria || null
    if (aplicarMarca) payload.marca = marca || null
    if (aplicarNcm) payload.ncm = ncm.trim() || null
    if (aplicarUnidade) payload.unidade = unidade
    if (aplicarPdv) payload.disponivel_pdv = disponivelPdv

    const sb = createClient()
    const { error } = await sb.from('produtos').update(payload).in('id', ids)
    if (error) { setSalvando(false); setErro(error.message); return }

    // Propaga categoria/marca (os únicos campos de identidade desta tela)
    // pros produtos vinculados numa empresa parceira, se houver.
    if (aplicarCategoria || aplicarMarca) {
      const camposIdentidade: Record<string, unknown> = {}
      if (aplicarCategoria) camposIdentidade.categoria = payload.categoria
      if (aplicarMarca) camposIdentidade.marca = payload.marca
      await Promise.all(ids.map(id => sincronizarProdutoVinculado(sb, id, camposIdentidade)))
    }

    setSalvando(false)
    onAplicado()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ações em massa</h2>
            <p className="text-xs text-gray-400">{ids.length} produto(s) selecionado(s)</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-xs text-gray-400">Marque os campos que quer alterar — os demais permanecem como estão.</p>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarCategoria} onChange={e => setAplicarCategoria(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Categoria / Subcategoria</span>
            </label>
            {aplicarCategoria && (
              <div className="grid grid-cols-2 gap-2 pl-6">
                <select value={categoria} onChange={e => { setCategoria(e.target.value); setSubcategoria('') }}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
                  <option value="">— Sem categoria —</option>
                  {categoriasRaiz.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select>
                <select value={subcategoria} disabled={subcategoriasDisponiveis.length === 0} onChange={e => setSubcategoria(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white disabled:bg-gray-100 disabled:text-gray-400">
                  <option value="">— Sem subcategoria —</option>
                  {subcategoriasDisponiveis.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarMarca} onChange={e => setAplicarMarca(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Marca</span>
            </label>
            {aplicarMarca && (
              <select value={marca} onChange={e => setMarca(e.target.value)}
                className="ml-6 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
                <option value="">— Sem marca —</option>
                {marcas.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </select>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarNcm} onChange={e => setAplicarNcm(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">NCM</span>
            </label>
            {aplicarNcm && (
              <input value={ncm} onChange={e => setNcm(e.target.value)} placeholder="Ex: 6109.10.00"
                className="ml-6 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 font-mono focus:outline-none focus:border-blue-500 w-40" />
            )}
          </div>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarUnidade} onChange={e => setAplicarUnidade(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Unidade</span>
            </label>
            {aplicarUnidade && (
              <select value={unidade} onChange={e => setUnidade(e.target.value)}
                className="ml-6 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg px-3 py-3">
            <label className="flex items-center gap-2.5 cursor-pointer mb-2">
              <input type="checkbox" checked={aplicarPdv} onChange={e => setAplicarPdv(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm font-medium text-gray-700">Disponível no PDV</span>
            </label>
            {aplicarPdv && (
              <div className="flex items-center gap-2 ml-6">
                <button type="button" onClick={() => setDisponivelPdv(true)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${disponivelPdv ? 'border-green-500 text-green-700 bg-green-50 font-medium' : 'border-gray-300 text-gray-500 bg-white'}`}>
                  Sim
                </button>
                <button type="button" onClick={() => setDisponivelPdv(false)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${!disponivelPdv ? 'border-red-500 text-red-700 bg-red-50 font-medium' : 'border-gray-300 text-gray-500 bg-white'}`}>
                  Não
                </button>
              </div>
            )}
          </div>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={aplicar} disabled={salvando || nenhumCampoSelecionado}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Aplicando...' : `Aplicar a ${ids.length} produto(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
