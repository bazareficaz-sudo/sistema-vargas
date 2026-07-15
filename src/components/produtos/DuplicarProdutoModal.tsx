'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { gerarProximoSku } from './sku'

type ProdutoResumo = { id: string; nome: string; tipo: string }

type ProdutoCompleto = {
  id: string
  unidade: string
  tipo: string
  permite_fracao: boolean
  disponivel_pdv: boolean
  categoria: string | null
  marca: string | null
  preco_venda: number
  preco_custo: number
  estoque: number
  estoque_minimo: number
  ncm: string | null
  cfop: string | null
  icms_cst: string | null
  icms_origem: number | null
  pis_cst: string | null
  cofins_cst: string | null
  codigo_fornecedor: string | null
  ibs_cst: string | null
  ibs_cclasstrib: string | null
  ibs_aliquota: number | null
  cbs_aliquota: number | null
}

type ProdutoImagem = { url: string; ordem: number; principal: boolean }

export default function DuplicarProdutoModal({ produto, empresaId, onClose, onDuplicado }: {
  produto: ProdutoResumo
  empresaId: string
  onClose: () => void
  onDuplicado: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [origem, setOrigem] = useState<ProdutoCompleto | null>(null)
  const [qtdImagens, setQtdImagens] = useState(0)

  const [nome, setNome] = useState(`${produto.nome} (cópia)`)
  const [sku, setSku] = useState('')
  const [skuDuplicado, setSkuDuplicado] = useState<any | null>(null)
  const [checandoSku, setChecandoSku] = useState(false)

  const [copiarCategoriaMarca, setCopiarCategoriaMarca] = useState(true)
  const [copiarPreco, setCopiarPreco] = useState(true)
  const [copiarEstoque, setCopiarEstoque] = useState(false)
  const [copiarFiscal, setCopiarFiscal] = useState(true)
  const [copiarImagens, setCopiarImagens] = useState(true)

  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    async function carregar() {
      const sb = createClient()
      const [{ data: prod }, { count }, proximoSku] = await Promise.all([
        sb.from('produtos').select('*').eq('id', produto.id).single(),
        sb.from('produto_imagens').select('id', { count: 'exact', head: true }).eq('produto_id', produto.id),
        gerarProximoSku(sb, empresaId),
      ])
      if (!ativo) return
      setOrigem(prod)
      setQtdImagens(count ?? 0)
      setSku(prev => prev === '' ? proximoSku : prev)
      setCarregando(false)
    }
    carregar()
    return () => { ativo = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produto.id, empresaId])

  async function checarSku() {
    const valor = sku.trim()
    if (!valor) { setSkuDuplicado(null); return }
    setChecandoSku(true)
    const sb = createClient()
    const { data } = await sb.from('produtos').select('id, nome').eq('empresa_id', empresaId).eq('sku', valor).maybeSingle()
    setSkuDuplicado(data ?? null)
    setChecandoSku(false)
  }

  async function copiarImagensParaNovoProduto(sb: ReturnType<typeof createClient>, produtoIdNovo: string) {
    const { data: imagens } = await sb
      .from('produto_imagens')
      .select('url, ordem, principal')
      .eq('produto_id', produto.id)
      .order('ordem', { ascending: true })
    if (!imagens || imagens.length === 0) return

    const novasLinhas: { empresa_id: string; produto_id: string; url: string; ordem: number; principal: boolean }[] = []
    for (const img of imagens as ProdutoImagem[]) {
      let novaUrl = img.url
      const path = img.url.split('/produto-imagens/')[1]
      if (path) {
        const ext = path.split('.').pop() || 'jpg'
        const novoPath = `${empresaId}/${produtoIdNovo}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error: copyError } = await sb.storage.from('produto-imagens').copy(path, novoPath)
        if (!copyError) {
          const { data: { publicUrl } } = sb.storage.from('produto-imagens').getPublicUrl(novoPath)
          novaUrl = publicUrl
        }
      }
      novasLinhas.push({ empresa_id: empresaId, produto_id: produtoIdNovo, url: novaUrl, ordem: img.ordem, principal: img.principal })
    }
    await sb.from('produto_imagens').insert(novasLinhas)
  }

  async function salvar() {
    if (!origem) return
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

    const payload: Record<string, unknown> = {
      empresa_id: empresaId,
      nome: nome.trim(),
      sku: skuFinal,
      ean: null,
      tipo: origem.tipo,
      unidade: origem.unidade,
      permite_fracao: origem.permite_fracao,
      disponivel_pdv: origem.disponivel_pdv,
      ativo: true,
      categoria: copiarCategoriaMarca ? origem.categoria : null,
      marca: copiarCategoriaMarca ? origem.marca : null,
      preco_venda: copiarPreco ? origem.preco_venda : 0,
      preco_custo: copiarPreco ? origem.preco_custo : 0,
      estoque: copiarEstoque ? origem.estoque : 0,
      estoque_minimo: copiarEstoque ? origem.estoque_minimo : 0,
      ncm: copiarFiscal ? origem.ncm : null,
      cfop: copiarFiscal ? origem.cfop : null,
      icms_cst: copiarFiscal ? origem.icms_cst : null,
      icms_origem: copiarFiscal ? origem.icms_origem : null,
      pis_cst: copiarFiscal ? origem.pis_cst : null,
      cofins_cst: copiarFiscal ? origem.cofins_cst : null,
      codigo_fornecedor: copiarFiscal ? origem.codigo_fornecedor : null,
      ibs_cst: copiarFiscal ? origem.ibs_cst : null,
      ibs_cclasstrib: copiarFiscal ? origem.ibs_cclasstrib : null,
      ibs_aliquota: copiarFiscal ? origem.ibs_aliquota : null,
      cbs_aliquota: copiarFiscal ? origem.cbs_aliquota : null,
    }

    const { data: novoProduto, error } = await sb.from('produtos').insert(payload).select().single()
    if (error) { setErro(error.message); setSalvando(false); return }

    if (copiarImagens && qtdImagens > 0) {
      await copiarImagensParaNovoProduto(sb, novoProduto.id)
    }

    setSalvando(false)
    onDuplicado()
  }

  const OPCOES = [
    { key: 'categoriaMarca', label: 'Categoria e marca', valor: copiarCategoriaMarca, set: setCopiarCategoriaMarca },
    { key: 'preco', label: 'Preço e custo', valor: copiarPreco, set: setCopiarPreco },
    { key: 'estoque', label: 'Estoque atual e mínimo', valor: copiarEstoque, set: setCopiarEstoque },
    { key: 'fiscal', label: 'Dados fiscais (NCM, CFOP, CST, IBS/CBS...)', valor: copiarFiscal, set: setCopiarFiscal },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Duplicar produto</h2>
            <p className="text-xs text-gray-400 truncate max-w-md">{produto.nome}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {carregando ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">Carregando...</div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nome do novo produto *</label>
              <input value={nome} onChange={e => setNome(e.target.value)}
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

            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">O que copiar do produto original</p>
              <div className="space-y-2">
                {OPCOES.map(op => (
                  <label key={op.key} className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={op.valor} onChange={e => op.set(e.target.checked)}
                      className="w-4 h-4 accent-blue-600" />
                    <span className="text-sm text-gray-700">{op.label}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2.5 border border-gray-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={copiarImagens} onChange={e => setCopiarImagens(e.target.checked)}
                    disabled={qtdImagens === 0}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm text-gray-700">
                    Imagens {qtdImagens > 0 ? `(${qtdImagens})` : '(produto original não tem imagens)'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Estoque vem desligado por padrão — o novo produto nasce com estoque 0 pra não duplicar contagem física real.
              </p>
            </div>

            {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando || carregando || !!skuDuplicado}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Duplicando...' : 'Duplicar produto'}
          </button>
        </div>
      </div>
    </div>
  )
}
