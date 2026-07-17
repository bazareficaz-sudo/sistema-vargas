'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type ProdutoTags = { id: string; tags: string[] }

export default function GerenciarTagsModal({ produtos, tagsExistentes, onClose, onAplicado }: {
  produtos: ProdutoTags[]
  tagsExistentes: string[]
  onClose: () => void
  onAplicado: () => void
}) {
  const [modo, setModo] = useState<'adicionar' | 'remover'>('adicionar')
  const [tag, setTag] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const tagsPresentes = Array.from(new Set(produtos.flatMap(p => p.tags ?? []))).sort()

  async function aplicar() {
    const valor = tag.trim()
    if (!valor) { setErro('Informe o nome da tag.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()
    for (const p of produtos) {
      const atuais = p.tags ?? []
      const novas = modo === 'adicionar'
        ? Array.from(new Set([...atuais, valor]))
        : atuais.filter(t => t !== valor)
      if (novas.length === atuais.length && novas.every(t => atuais.includes(t))) continue
      const { error } = await sb.from('produtos').update({ tags: novas }).eq('id', p.id)
      if (error) { setErro(error.message); setSalvando(false); return }
    }
    setSalvando(false)
    onAplicado()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Gerenciar tags</h2>
            <p className="text-xs text-gray-400">{produtos.length} produto(s) selecionado(s)</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => setModo('adicionar')}
              className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${modo === 'adicionar' ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium' : 'border-gray-300 text-gray-500 bg-white'}`}>
              + Adicionar tag
            </button>
            <button type="button" onClick={() => setModo('remover')}
              className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${modo === 'remover' ? 'border-red-500 text-red-600 bg-red-50 font-medium' : 'border-gray-300 text-gray-500 bg-white'}`}>
              − Remover tag
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tag</label>
            <input
              list="tags-sugestoes"
              value={tag}
              onChange={e => setTag(e.target.value)}
              placeholder="Ex: online"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <datalist id="tags-sugestoes">
              {(modo === 'remover' ? tagsPresentes : tagsExistentes).map(t => <option key={t} value={t} />)}
            </datalist>
          </div>

          {modo === 'remover' && tagsPresentes.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Tags nos produtos selecionados</p>
              <div className="flex flex-wrap gap-1.5">
                {tagsPresentes.map(t => (
                  <button key={t} type="button" onClick={() => setTag(t)}
                    className="px-2 py-1 text-xs rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={aplicar} disabled={salvando || !tag.trim()}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Aplicando...' : modo === 'adicionar' ? `Adicionar a ${produtos.length} produto(s)` : `Remover de ${produtos.length} produto(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
