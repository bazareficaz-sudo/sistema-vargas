'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'

const UNIDADES = ['UN', 'KG', 'LT', 'MT', 'CX', 'PC', 'PR', 'DZ', 'CT', 'M2', 'M3', 'GR', 'ML', 'CM']

type Variacao = { id: string; nome_variacao: string | null; sku_variacao: string | null; preco: number | null; estoque: number | null }

export default function CriarProdutoModal({ anuncio, variacao, canal, empresaId, operador, onClose, onCriado }: {
  anuncio: any; variacao?: Variacao; canal: any; empresaId: string; operador: string
  onClose: () => void
  onCriado: (produto: any) => void
}) {
  const isVariacao = !!variacao

  const [categorias, setCategorias] = useState<{ id: string; nome: string }[]>([])
  const [marcas, setMarcas] = useState<{ id: string; nome: string }[]>([])
  const [form, setForm] = useState({
    nome: isVariacao ? (variacao!.nome_variacao || anuncio.titulo) : anuncio.titulo,
    sku: (isVariacao ? variacao!.sku_variacao : anuncio.sku_canal) ?? '',
    marca: anuncio.marca_externa ?? '',
    categoria: '',
    preco_venda: String(isVariacao ? (variacao!.preco ?? anuncio.preco_venda) : anuncio.preco_venda),
    preco_custo: '',
    estoque: String(isVariacao ? (variacao!.estoque ?? 0) : (anuncio.estoque_externo ?? 0)),
    disponivel_pdv: false,
  })
  const imagensDisponiveis: string[] = anuncio.imagens ?? []
  const [imagensSelecionadas, setImagensSelecionadas] = useState<Set<string>>(new Set(imagensDisponiveis))

  const [skuDuplicado, setSkuDuplicado] = useState<any | null>(null)
  const [checandoSku, setChecandoSku] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const sb = createClient()
    Promise.all([
      sb.from('categorias').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
      sb.from('marcas').select('id, nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
    ]).then(([cats, mks]) => {
      setCategorias(cats.data ?? [])
      setMarcas(mks.data ?? [])
    })
  }, [empresaId])

  function f(k: string, v: any) { setForm(p => ({ ...p, [k]: v })) }

  function toggleImagem(url: string) {
    setImagensSelecionadas(prev => {
      const novo = new Set(prev)
      if (novo.has(url)) novo.delete(url); else novo.add(url)
      return novo
    })
  }

  async function checarSku() {
    const sku = form.sku.trim()
    if (!sku) { setSkuDuplicado(null); return }
    setChecandoSku(true)
    const sb = createClient()
    const { data } = await sb.from('produtos').select('id, nome').eq('empresa_id', empresaId).eq('sku', sku).maybeSingle()
    setSkuDuplicado(data ?? null)
    setChecandoSku(false)
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro('Nome é obrigatório.'); return }
    setSalvando(true); setErro('')
    const sb = createClient()

    // Checagem final de SKU duplicado antes de gravar (segurança extra além
    // da checagem no blur — sem constraint única em produtos.sku no banco).
    const sku = form.sku.trim() || null
    if (sku) {
      const { data: existente } = await sb.from('produtos').select('id, nome').eq('empresa_id', empresaId).eq('sku', sku).maybeSingle()
      if (existente) {
        setErro(`Já existe um produto com este SKU: "${existente.nome}". Edite o SKU ou mapeie o anúncio a esse produto existente em vez de criar um novo.`)
        setSalvando(false)
        return
      }
    }

    const { data: produto, error } = await sb.from('produtos').insert({
      empresa_id: empresaId,
      nome: form.nome.trim(),
      sku,
      marca: form.marca || null,
      categoria: form.categoria || null,
      preco_venda: parseFloat(form.preco_venda) || 0,
      preco_custo: parseFloat(form.preco_custo) || 0,
      estoque: parseFloat(form.estoque) || 0,
      unidade: 'UN',
      tipo: 'simples',
      ativo: true,
      disponivel_pdv: form.disponivel_pdv,
    }).select().single()

    if (error) { setErro(error.message); setSalvando(false); return }

    const urlsImportar = [...imagensSelecionadas]
    if (urlsImportar.length > 0) {
      await sb.from('produto_imagens').insert(urlsImportar.map((url, i) => ({
        empresa_id: empresaId,
        produto_id: produto.id,
        url,
        ordem: i,
        principal: i === 0,
      })))
    }

    if (isVariacao) {
      await sb.from('marketplace_anuncio_variacoes').update({ produto_id: produto.id }).eq('id', variacao!.id)
    } else {
      await sb.from('marketplace_anuncios').update({ produto_id: produto.id }).eq('id', anuncio.id)
    }

    const chave = isVariacao ? variacao!.sku_variacao : anuncio.sku_canal
    if (chave) {
      await sb.from('marketplace_mapeamentos').upsert({
        empresa_id: empresaId, canal_id: canal.id,
        nivel: isVariacao ? 'variacao' : 'anuncio', chave,
        anuncio_id: anuncio.id, variacao_id: isVariacao ? variacao!.id : null,
        produto_id: produto.id, produto_nome_snapshot: produto.nome, produto_sku_snapshot: produto.sku,
        metodo: 'criado', operador, updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id,canal_id,nivel,chave' })
    }

    setSalvando(false)
    onCriado(produto)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Criar produto{isVariacao ? ' (variação)' : ''}</h2>
            <p className="text-xs text-gray-400 truncate max-w-md">{isVariacao ? (variacao!.nome_variacao || variacao!.sku_variacao) : anuncio.titulo}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
            <input value={form.nome} onChange={e => f('nome', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
              <input value={form.sku} onChange={e => { f('sku', e.target.value); setSkuDuplicado(null) }} onBlur={checarSku}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
              {checandoSku && <p className="text-xs text-gray-400 mt-1">Verificando...</p>}
              {skuDuplicado && (
                <p className="text-xs text-red-600 mt-1">Já existe: "{skuDuplicado.nome}" — troque o SKU ou mapeie a esse produto em vez de criar um novo.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Marca</label>
              <input value={form.marca} onChange={e => f('marca', e.target.value)} list="marcas-lista"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              <datalist id="marcas-lista">
                {marcas.map(m => <option key={m.id} value={m.nome} />)}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Categoria</label>
            <select value={form.categoria} onChange={e => f('categoria', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="">— Sem categoria —</option>
              {categorias.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">A Shopee não fornece uma categoria compatível com o sistema — escolha manualmente.</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Preço de venda (R$)</label>
              <input type="number" step="0.01" value={form.preco_venda} onChange={e => f('preco_venda', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Preço de custo (R$)</label>
              <input type="number" step="0.01" value={form.preco_custo} onChange={e => f('preco_custo', e.target.value)}
                placeholder="0,00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Estoque inicial</label>
              <input type="number" value={form.estoque} onChange={e => f('estoque', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <input type="checkbox" checked={form.disponivel_pdv} onChange={e => f('disponivel_pdv', e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-amber-600" />
            <div>
              <p className="text-xs font-medium text-amber-800">Disponível no PDV</p>
              <p className="text-xs text-amber-600">A Shopee não informa o custo de aquisição — revise o preço de custo antes de liberar a venda no PDV. Vem desmarcado por padrão.</p>
            </div>
          </div>

          {!isVariacao && imagensDisponiveis.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Imagens a importar ({imagensSelecionadas.size} de {imagensDisponiveis.length})</p>
              <div className="grid grid-cols-4 gap-2">
                {imagensDisponiveis.map((url, i) => (
                  <label key={i} className="relative cursor-pointer">
                    <img src={url} alt="" className={`w-full h-20 object-cover rounded-lg border-2 ${imagensSelecionadas.has(url) ? 'border-blue-400' : 'border-gray-200 opacity-50'}`} />
                    <input type="checkbox" checked={imagensSelecionadas.has(url)} onChange={() => toggleImagem(url)}
                      className="absolute top-1 right-1 w-4 h-4 accent-blue-600" />
                  </label>
                ))}
              </div>
            </div>
          )}
          {isVariacao && imagensDisponiveis.length > 0 && (
            <p className="text-xs text-gray-400">As imagens do anúncio principal ({imagensDisponiveis.length}) serão herdadas por este produto.</p>
          )}

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
