'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { gerarProximoSku } from './sku'

type ProdutoBase = {
  id: string
  nome: string
  unidade: string
  categoria: string | null
  marca: string | null
  preco_venda: number
  preco_custo: number
  estoque: number
  disponivel_pdv: boolean
}

export default function CriarKitModal({ produto, empresaId, onClose, onCriado }: {
  produto: ProdutoBase
  empresaId: string
  onClose: () => void
  onCriado: () => void
}) {
  const [quantidade, setQuantidade] = useState(2)
  const [nome, setNome] = useState(`${produto.nome} - Kit 2un`)
  const [nomeEditadoManualmente, setNomeEditadoManualmente] = useState(false)
  const [sku, setSku] = useState('')
  const [skuDuplicado, setSkuDuplicado] = useState<any | null>(null)
  const [checandoSku, setChecandoSku] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

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

  function alterarQuantidade(v: number) {
    setQuantidade(v)
    if (!nomeEditadoManualmente) setNome(`${produto.nome} - Kit ${v}un`)
  }

  function alterarNome(v: string) {
    setNome(v)
    setNomeEditadoManualmente(true)
  }

  async function salvar() {
    if (!nome.trim()) { setErro('Nome é obrigatório.'); return }
    if (!(quantidade > 0)) { setErro('Quantidade deve ser maior que zero.'); return }
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

    const estoqueKit = produto.estoque > 0 ? Math.floor(produto.estoque / quantidade) : 0

    const { data: novoProduto, error } = await sb.from('produtos').insert({
      empresa_id: empresaId,
      nome: nome.trim(),
      sku: skuFinal,
      tipo: 'kit',
      unidade: produto.unidade,
      categoria: produto.categoria,
      marca: produto.marca,
      preco_custo: parseFloat((produto.preco_custo * quantidade).toFixed(2)),
      preco_venda: parseFloat((produto.preco_venda * quantidade).toFixed(2)),
      estoque: estoqueKit,
      estoque_minimo: 0,
      disponivel_pdv: produto.disponivel_pdv,
      ativo: true,
    }).select().single()

    if (error) { setErro(error.message); setSalvando(false); return }

    const { error: kitError } = await sb.from('kit_itens').insert({
      kit_id: novoProduto.id,
      produto_id: produto.id,
      quantidade,
    })
    if (kitError) {
      setErro('O kit foi criado, mas houve falha ao vincular o componente: ' + kitError.message)
      setSalvando(false)
      return
    }

    setSalvando(false)
    onCriado()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Criar kit</h2>
            <p className="text-xs text-gray-400 truncate max-w-xs">a partir de "{produto.nome}"</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quantidade por kit</label>
            <input type="number" min={0.0001} step={0.0001} value={quantidade}
              onChange={e => alterarQuantidade(parseFloat(e.target.value) || 0)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome do kit</label>
            <input value={nome} onChange={e => alterarNome(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
            <input value={sku} onChange={e => { setSku(e.target.value); setSkuDuplicado(null) }} onBlur={checarSku}
              placeholder="Sugestão automática — pode editar"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
            {checandoSku && <p className="text-xs text-gray-400 mt-1">Verificando...</p>}
            {skuDuplicado && (
              <p className="text-xs text-red-600 mt-1">Já existe: "{skuDuplicado.nome}" — troque o SKU.</p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
            1 kit = {quantidade}x "{produto.nome}". Preço de venda sugerido: {(produto.preco_venda * quantidade).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} — pode ser ajustado depois editando o kit.
          </div>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || !!skuDuplicado}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Criando...' : 'Criar kit'}
          </button>
        </div>
      </div>
    </div>
  )
}
