'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { gerarProximoSku } from './sku'

const UNIDADES = ['UN', 'KG', 'LT', 'MT', 'CX', 'PC', 'PR', 'DZ', 'CT', 'M2', 'M3', 'GR', 'ML', 'CM']

type Categoria = { id: string; nome: string; pai_id: string | null }
type Marca = { id: string; nome: string }

type Dados = {
  titulo: string; descricao: string; preco: number; imagens: string[]
  categoriaNomeExterna: string | null; marcaSugerida: string | null; temVariacoes: boolean
}

export default function ImportarProdutoUrlModal({ empresaId, categoriasRaiz, categoriasTodas, marcas, onClose, onImportado }: {
  empresaId: string
  categoriasRaiz: Categoria[]
  categoriasTodas: Categoria[]
  marcas: Marca[]
  onClose: () => void
  onImportado: (produto: any) => void
}) {
  const [url, setUrl] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [erroBusca, setErroBusca] = useState('')
  const [dados, setDados] = useState<Dados | null>(null)

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
  const [disponivelPdv, setDisponivelPdv] = useState(false)
  const [imagensSelecionadas, setImagensSelecionadas] = useState<Set<string>>(new Set())

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const subcategoriasDisponiveis = categoria
    ? categoriasTodas.filter(c => c.pai_id && categoriasTodas.find(r => r.id === c.pai_id)?.nome === categoria)
    : []

  function toggleImagem(u: string) {
    setImagensSelecionadas(prev => {
      const novo = new Set(prev)
      if (novo.has(u)) novo.delete(u); else novo.add(u)
      return novo
    })
  }

  async function buscar() {
    if (!url.trim()) return
    setBuscando(true); setErroBusca('')
    const sb = createClient()
    try {
      const resp = await fetch('/api/marketplace/mercadolivre/importar-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await resp.json()
      if (!data.ok) { setErroBusca(data.erro ?? 'Erro ao importar anúncio'); return }

      const d: Dados = data.dados
      setDados(d)
      setNome(d.titulo)
      setPrecoVenda(d.preco ? String(d.preco) : '')
      setImagensSelecionadas(new Set(d.imagens))
      const marcaEncontrada = d.marcaSugerida
        ? marcas.find(m => m.nome.toLowerCase() === d.marcaSugerida!.toLowerCase())
        : null
      setMarca(marcaEncontrada?.nome ?? '')

      const proximoSku = await gerarProximoSku(sb, empresaId)
      setSku(proximoSku)
    } catch (e: any) {
      setErroBusca(e.message ?? 'Erro ao importar anúncio')
    } finally {
      setBuscando(false)
    }
  }

  async function checarSku() {
    const valor = sku.trim()
    if (!valor) { setSkuDuplicado(null); return }
    setChecandoSku(true)
    const sb = createClient()
    const { data } = await sb.from('produtos').select('id, nome').eq('empresa_id', empresaId).eq('sku', valor).maybeSingle()
    setSkuDuplicado(data ?? null)
    setChecandoSku(false)
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

    const { data: produto, error } = await sb.from('produtos').insert({
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
    }).select().single()

    if (error) { setErro(error.message); setSalvando(false); return }

    const urlsImportar = [...imagensSelecionadas]
    if (urlsImportar.length > 0) {
      await sb.from('produto_imagens').insert(urlsImportar.map((u, i) => ({
        empresa_id: empresaId,
        produto_id: produto.id,
        url: u,
        ordem: i,
        principal: i === 0,
      })))
    }

    setSalvando(false)
    onImportado(produto)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">Importar produto por URL</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">URL do anúncio no Mercado Livre</label>
            <div className="flex gap-2">
              <input value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && buscar()}
                placeholder="https://produto.mercadolivre.com.br/MLB-..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              <button onClick={buscar} disabled={buscando || !url.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap">
                {buscando ? 'Buscando...' : 'Buscar'}
              </button>
            </div>
            {erroBusca && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{erroBusca}</p>}
          </div>

          {dados && (
            <>
              {dados.temVariacoes && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                  ⚠️ Este anúncio possui variações — o preço mostrado é o valor base. Revise antes de salvar.
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
                <input value={nome} onChange={e => setNome(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
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
                  {dados.categoriaNomeExterna && (
                    <p className="text-xs text-gray-400 mt-1">No Mercado Livre: {dados.categoriaNomeExterna} (referência — não é compatível 1:1)</p>
                  )}
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
                  {dados.marcaSugerida && !marca && (
                    <p className="text-xs text-gray-400 mt-1">Sugestão: {dados.marcaSugerida}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Preço de venda (R$)</label>
                  <input type="number" step="0.01" value={precoVenda} onChange={e => setPrecoVenda(e.target.value)}
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

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <input type="checkbox" checked={disponivelPdv} onChange={e => setDisponivelPdv(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-amber-600" />
                <div>
                  <p className="text-xs font-medium text-amber-800">Disponível no PDV</p>
                  <p className="text-xs text-amber-600">O Mercado Livre não informa o custo de aquisição — revise o preço de custo antes de liberar a venda no PDV. Vem desmarcado por padrão.</p>
                </div>
              </div>

              {dados.imagens.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Imagens a importar ({imagensSelecionadas.size} de {dados.imagens.length})</p>
                  <div className="grid grid-cols-4 gap-2">
                    {dados.imagens.map((u, i) => (
                      <label key={i} className="relative cursor-pointer">
                        <img src={u} alt="" className={`w-full h-20 object-cover rounded-lg border-2 ${imagensSelecionadas.has(u) ? 'border-blue-400' : 'border-gray-200 opacity-50'}`} />
                        <input type="checkbox" checked={imagensSelecionadas.has(u)} onChange={() => toggleImagem(u)}
                          className="absolute top-1 right-1 w-4 h-4 accent-blue-600" />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          {dados && (
            <button onClick={salvar} disabled={salvando || !!skuDuplicado}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {salvando ? 'Importando...' : 'Importar produto'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
