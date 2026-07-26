'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { gerarProximoSku } from './sku'

const UNIDADES = ['UN', 'KG', 'LT', 'MT', 'CX', 'PC', 'PR', 'DZ', 'CT', 'M2', 'M3', 'GR', 'ML', 'CM']

type Categoria = { id: string; nome: string; pai_id: string | null }
type Marca = { id: string; nome: string }

export default function NovoProdutoModal({ empresaId, categoriasRaiz, categoriasTodas, marcas, onClose, onCriado }: {
  empresaId: string
  categoriasRaiz: Categoria[]
  categoriasTodas: Categoria[]
  marcas: Marca[]
  onClose: () => void
  onCriado: () => void
}) {
  const [nome, setNome] = useState('')
  const [sku, setSku] = useState('')
  const [skuDuplicado, setSkuDuplicado] = useState<any | null>(null)
  const [checandoSku, setChecandoSku] = useState(false)
  const [categoria, setCategoria] = useState('')
  const [subcategoria, setSubcategoria] = useState('')
  const [marca, setMarca] = useState('')
  const [unidade, setUnidade] = useState('UN')
  const [precoVenda, setPrecoVenda] = useState('')
  const [precoCusto, setPrecoCusto] = useState('')
  const [estoque, setEstoque] = useState('0')
  const [disponivelPdv, setDisponivelPdv] = useState(true)

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [preenchendoIA, setPreenchendoIA] = useState(false)
  const [mensagemIA, setMensagemIA] = useState('')
  const [tituloSugerido, setTituloSugerido] = useState('')

  const subcategoriasDisponiveis = categoria
    ? categoriasTodas.filter(c => c.pai_id && categoriasTodas.find(r => r.id === c.pai_id)?.nome === categoria)
    : []

  // Sugere o próximo SKU sequencial (editável) ao abrir o modal
  useEffect(() => {
    const sb = createClient()
    gerarProximoSku(sb, empresaId).then(v => setSku(prev => prev === '' ? v : prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  async function checarSku() {
    const valor = sku.trim()
    if (!valor) { setSkuDuplicado(null); return }
    setChecandoSku(true)
    const sb = createClient()
    const { data } = await sb.from('produtos').select('id, nome').eq('empresa_id', empresaId).eq('sku', valor).maybeSingle()
    setSkuDuplicado(data ?? null)
    setChecandoSku(false)
  }

  async function preencherComIA() {
    if (!nome.trim()) return
    setPreenchendoIA(true); setErro(''); setMensagemIA(''); setTituloSugerido('')
    try {
      const res = await fetch('/api/produtos/ia-enriquecer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoNome: nome, produtoEan: '' }),
      })
      const data = await res.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao consultar a IA'); return }

      if (data.titulo_sugerido) setTituloSugerido(data.titulo_sugerido)

      let preenchidos = 0
      if (!categoria && data.categoria) {
        const raiz = categoriasRaiz.find(c => c.nome === data.categoria)
        if (raiz) {
          setCategoria(raiz.nome); preenchidos++
        } else {
          const filha = categoriasTodas.find(c => c.nome === data.categoria && c.pai_id)
          const pai = filha ? categoriasTodas.find(r => r.id === filha.pai_id) : undefined
          if (filha && pai) { setCategoria(pai.nome); setSubcategoria(filha.nome); preenchidos++ }
        }
      }
      if (!marca && data.marca) { setMarca(data.marca); preenchidos++ }

      setMensagemIA(preenchidos > 0
        ? `✓ ${preenchidos} campo(s) preenchido(s) pela IA — revise antes de salvar.`
        : 'A IA não encontrou sugestões novas pra categoria/marca — os campos já estavam preenchidos ou não há confiança suficiente.')
    } catch {
      setErro('Erro ao consultar a IA — tente novamente.')
    } finally {
      setPreenchendoIA(false)
    }
  }

  function usarTituloSugerido() {
    setNome(tituloSugerido)
    setTituloSugerido('')
  }

  async function salvar() {
    if (!nome.trim()) { setErro('Nome é obrigatório.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()

    const skuFinal = sku.trim() || null
    if (skuFinal) {
      const { data: existente } = await sb.from('produtos').select('id, nome').eq('empresa_id', empresaId).eq('sku', skuFinal).maybeSingle()
      if (existente) {
        setErro(`Já existe um produto com este SKU: "${existente.nome}".`)
        setSalvando(false)
        return
      }
    }

    const { error } = await sb.from('produtos').insert({
      empresa_id: empresaId,
      nome: nome.trim(),
      sku: skuFinal,
      tipo: 'simples',
      unidade,
      categoria: subcategoria || categoria || null,
      marca: marca || null,
      preco_venda: parseFloat(precoVenda) || 0,
      preco_custo: parseFloat(precoCusto) || 0,
      estoque: parseFloat(estoque) || 0,
      ativo: true,
      disponivel_pdv: disponivelPdv,
    })

    setSalvando(false)
    if (error) { setErro(error.message); return }
    onCriado()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">Novo produto</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div>
            <button type="button" onClick={preencherComIA} disabled={preenchendoIA || !nome.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 border border-violet-200 text-violet-700 text-sm font-medium rounded-lg transition-colors">
              {preenchendoIA ? '✨ Pensando...' : '✨ Preencher com IA (título, categoria, marca)'}
            </button>
            {mensagemIA && (
              <p className="text-xs text-violet-600 mt-1.5">{mensagemIA}</p>
            )}
            {tituloSugerido && (
              <div className="mt-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2.5">
                <p className="text-xs text-violet-700 mb-1.5">
                  <span className="font-medium">Título sugerido:</span> {tituloSugerido}
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={usarTituloSugerido}
                    className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg transition-colors">
                    Usar este título
                  </button>
                  <button type="button" onClick={() => setTituloSugerido('')}
                    className="px-3 py-1 border border-violet-300 text-violet-600 text-xs rounded-lg hover:bg-violet-100 transition-colors">
                    Ignorar
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
              <input value={sku} onChange={e => { setSku(e.target.value); setSkuDuplicado(null) }} onBlur={checarSku}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
              {checandoSku && <p className="text-xs text-gray-400 mt-1">Verificando...</p>}
              {skuDuplicado && (
                <p className="text-xs text-red-600 mt-1">Já existe: "{skuDuplicado.nome}" — troque o SKU.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unidade</label>
              <select value={unidade} onChange={e => setUnidade(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
              <select value={categoria} onChange={e => { setCategoria(e.target.value); setSubcategoria('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                <option value="">— Sem categoria —</option>
                {categoriasRaiz.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subcategoria</label>
              <select value={subcategoria} disabled={subcategoriasDisponiveis.length === 0} onChange={e => setSubcategoria(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white disabled:bg-gray-100 disabled:text-gray-400">
                <option value="">— Nenhuma —</option>
                {subcategoriasDisponiveis.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Marca</label>
              <select value={marca} onChange={e => setMarca(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
                <option value="">— Sem marca —</option>
                {marcas.map(m => <option key={m.id} value={m.nome}>{m.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Preço de venda (R$)</label>
              <input type="number" step="0.01" value={precoVenda} onChange={e => setPrecoVenda(e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Preço de custo (R$)</label>
              <input type="number" step="0.01" value={precoCusto} onChange={e => setPrecoCusto(e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Estoque inicial</label>
              <input type="number" value={estoque} onChange={e => setEstoque(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <label className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50 w-fit">
            <input type="checkbox" checked={disponivelPdv} onChange={e => setDisponivelPdv(e.target.checked)}
              className="w-4 h-4 accent-blue-600" />
            <span className="text-sm text-gray-700">Disponível no PDV</span>
          </label>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || !!skuDuplicado}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Criando...' : 'Criar produto'}
          </button>
        </div>
      </div>
    </div>
  )
}
