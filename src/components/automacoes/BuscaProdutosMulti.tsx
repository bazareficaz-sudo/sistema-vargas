'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type ProdutoRef = { produto_id: string; produto_nome: string; produto_sku: string | null }

export default function BuscaProdutosMulti({ empresaId, selecionados, onChange }: {
  empresaId: string
  selecionados: ProdutoRef[]
  onChange: (produtos: ProdutoRef[]) => void
}) {
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<{ id: string; nome: string; sku: string | null; marca: string | null }[]>([])
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    if (busca.trim().length < 2) { setResultados([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      const sb = createClient()
      const { data } = await sb.from('produtos').select('id, nome, sku, marca')
        .eq('empresa_id', empresaId).eq('ativo', true)
        .or(`nome.ilike.%${busca}%,sku.ilike.%${busca}%`)
        .limit(15)
      setResultados(data ?? [])
      setBuscando(false)
    }, 300)
    return () => clearTimeout(t)
  }, [busca, empresaId])

  function adicionar(p: { id: string; nome: string; sku: string | null }) {
    if (selecionados.some(s => s.produto_id === p.id)) return
    onChange([...selecionados, { produto_id: p.id, produto_nome: p.nome, produto_sku: p.sku }])
  }

  function remover(produtoId: string) {
    onChange(selecionados.filter(s => s.produto_id !== produtoId))
  }

  return (
    <div>
      {selecionados.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selecionados.map(p => (
            <span key={p.produto_id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full border border-blue-200">
              {p.produto_nome}{p.produto_sku ? ` (${p.produto_sku})` : ''}
              <button type="button" onClick={() => remover(p.produto_id)} className="text-blue-400 hover:text-blue-600">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar produto por nome ou SKU..."
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
      </div>
      {busca.trim().length >= 2 && (
        <div className="mt-1.5 border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
          {buscando && <div className="px-3 py-2 text-xs text-gray-400">Buscando...</div>}
          {!buscando && resultados.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">Nenhum produto encontrado.</div>}
          {resultados.map(p => {
            const jaAdicionado = selecionados.some(s => s.produto_id === p.id)
            return (
              <div key={p.id} className={`flex items-center justify-between px-3 py-2 border-b border-gray-100 last:border-0 text-sm ${jaAdicionado ? 'opacity-50' : ''}`}>
                <div className="min-w-0">
                  <p className="text-gray-800 truncate">{p.nome}</p>
                  <p className="text-xs text-gray-400">{p.sku}{p.marca ? ` · ${p.marca}` : ''}</p>
                </div>
                {jaAdicionado ? (
                  <span className="text-green-600 text-xs flex-shrink-0">✓ adicionado</span>
                ) : (
                  <button type="button" onClick={() => adicionar(p)}
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm flex-shrink-0">+</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
