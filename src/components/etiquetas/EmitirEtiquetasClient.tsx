'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ImprimirEtiquetaModal from './ImprimirEtiquetaModal'
import type { ProdutoParaEtiqueta } from '@/lib/etiquetas/tipos'

type Marca = { id: string; nome: string }
type Categoria = { id: string; nome: string }
type ProdutoResultado = ProdutoParaEtiqueta & { estoque: number }

const SELECT = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500 bg-white min-w-[150px]'

export default function EmitirEtiquetasClient({ empresaId, marcas, categorias, tagsDisponiveis }: {
  empresaId: string
  marcas: Marca[]
  categorias: Categoria[]
  tagsDisponiveis: string[]
}) {
  const [marcaF, setMarcaF] = useState('')
  const [categoriaF, setCategoriaF] = useState('')
  const [tagF, setTagF] = useState('')
  const [promocaoF, setPromocaoF] = useState(false)
  const [estoqueF, setEstoqueF] = useState<'' | 'com' | 'sem'>('')
  const [semEan, setSemEan] = useState(false)

  const [buscando, setBuscando] = useState(false)
  const [resultado, setResultado] = useState<ProdutoResultado[] | null>(null)
  const [imprimindo, setImprimindo] = useState(false)

  const algumFiltroAtivo = !!(marcaF || categoriaF || tagF || promocaoF || estoqueF || semEan)

  async function buscar() {
    setBuscando(true); setResultado(null)
    const sb = createClient()
    let q = sb.from('produtos')
      .select('id, nome, sku, ean, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, marca, unidade, categoria, estoque')
      .eq('empresa_id', empresaId).eq('ativo', true)

    if (marcaF) q = q.eq('marca', marcaF)
    if (categoriaF) q = q.eq('categoria', categoriaF)
    if (tagF) q = q.contains('tags', [tagF])
    if (promocaoF) q = q.eq('promocao_ativa', true)
    if (estoqueF === 'com') q = q.gt('estoque', 0)
    if (estoqueF === 'sem') q = q.lte('estoque', 0)
    if (semEan) q = q.is('ean', null)

    const { data } = await q.order('nome').limit(2000)
    setResultado(data ?? [])
    setBuscando(false)
  }

  function limpar() {
    setMarcaF(''); setCategoriaF(''); setTagF(''); setPromocaoF(false); setEstoqueF(''); setSemEan(false)
    setResultado(null)
  }

  return (
    <>
      {imprimindo && resultado && (
        <ImprimirEtiquetaModal produtos={resultado} empresaId={empresaId} onClose={() => setImprimindo(false)} />
      )}

      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <span>estoque</span><span>›</span>
        <span className="text-gray-600 font-medium">emitir etiquetas</span>
      </div>

      <div className="mb-5">
        <h1 className="text-gray-900 text-xl font-semibold">Emitir Etiquetas</h1>
        <p className="text-gray-500 text-sm mt-0.5">Filtre um grupo de produtos e imprima as etiquetas de todos de uma vez</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Marca</label>
            <select value={marcaF} onChange={e => setMarcaF(e.target.value)} className={SELECT}>
              <option value="">Todas</option>
              {marcas.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Categoria</label>
            <select value={categoriaF} onChange={e => setCategoriaF(e.target.value)} className={SELECT}>
              <option value="">Todas</option>
              {categorias.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
            </select>
          </div>
          {tagsDisponiveis.length > 0 && (
            <div>
              <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Tag</label>
              <select value={tagF} onChange={e => setTagF(e.target.value)} className={SELECT}>
                <option value="">Todas</option>
                {tagsDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1">Estoque</label>
            <div className="flex gap-1">
              {[{ v: 'com', l: 'Com estoque' }, { v: 'sem', l: 'Sem estoque' }].map(op => (
                <button key={op.v} type="button" onClick={() => setEstoqueF(prev => prev === op.v ? '' : op.v as 'com' | 'sem')}
                  className={`px-2.5 py-1.5 text-xs rounded-full border transition-colors ${estoqueF === op.v ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium' : 'border-gray-300 text-gray-500 bg-white hover:bg-gray-50'}`}>
                  {op.l}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setPromocaoF(v => !v)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${promocaoF ? 'border-orange-400 text-orange-600 bg-orange-50 font-medium' : 'border-gray-300 text-gray-500 bg-white hover:bg-gray-50'}`}>
            🏷 Em promoção
          </button>
          <button type="button" onClick={() => setSemEan(v => !v)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${semEan ? 'border-red-400 text-red-600 bg-red-50 font-medium' : 'border-gray-300 text-gray-500 bg-white hover:bg-gray-50'}`}>
            Sem código de barras
          </button>

          <div className="flex gap-2 ml-auto">
            {algumFiltroAtivo && (
              <button type="button" onClick={limpar} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">⊗ limpar</button>
            )}
            <button type="button" onClick={buscar} disabled={buscando}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {buscando ? 'Buscando...' : 'Buscar produtos'}
            </button>
          </div>
        </div>
      </div>

      {resultado !== null && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          {resultado.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Nenhum produto encontrado com esses filtros.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-700"><strong>{resultado.length}</strong> produto(s) encontrado(s){resultado.length === 2000 && ' (limite de 2000 atingido)'}</p>
                <button onClick={() => setImprimindo(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                  🏷️ Emitir etiquetas destes {resultado.length} produtos
                </button>
              </div>
              <div className="border border-gray-100 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
                {resultado.slice(0, 200).map(p => (
                  <div key={p.id} className="px-3 py-1.5 flex items-center justify-between text-xs text-gray-600">
                    <span className="truncate">{p.nome} {p.sku && <span className="text-gray-400">· {p.sku}</span>}</span>
                    <span className="text-gray-400 flex-shrink-0 ml-2">{p.estoque} un.</span>
                  </div>
                ))}
                {resultado.length > 200 && (
                  <div className="px-3 py-1.5 text-xs text-gray-400 text-center">+ {resultado.length - 200} produto(s) não exibido(s) na prévia</div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
