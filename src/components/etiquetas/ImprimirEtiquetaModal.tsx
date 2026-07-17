'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ModeloEtiqueta, ProdutoParaEtiqueta } from '@/lib/etiquetas/tipos'

type ProdutoComEstoque = ProdutoParaEtiqueta & { estoque?: number }

export default function ImprimirEtiquetaModal({ produtos, empresaId, operadorNome, onClose, modoQtdPadrao = 'fixa', labelModoEstoque = 'Igual ao estoque atual' }: {
  produtos: ProdutoComEstoque[]
  empresaId: string
  operadorNome?: string
  onClose: () => void
  modoQtdPadrao?: 'fixa' | 'estoque'
  labelModoEstoque?: string
}) {
  const [modelos, setModelos] = useState<ModeloEtiqueta[]>([])
  const [modeloId, setModeloId] = useState('')
  const [modoQtd, setModoQtd] = useState<'fixa' | 'estoque'>(modoQtdPadrao)
  const [qtdFixa, setQtdFixa] = useState('1')
  const [quantidades, setQuantidades] = useState<Record<string, number>>(
    modoQtdPadrao === 'estoque'
      ? Object.fromEntries(produtos.map(p => [p.id, Math.max(0, p.estoque ?? 0)]))
      : Object.fromEntries(produtos.map(p => [p.id, 1]))
  )
  const [carregando, setCarregando] = useState(true)
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let ativo = true
    const sb = createClient()
    sb.from('etiqueta_modelos').select('*').eq('empresa_id', empresaId).eq('ativo', true).order('nome')
      .then(({ data }) => {
        if (!ativo) return
        setModelos((data ?? []) as ModeloEtiqueta[])
        if (data && data.length > 0) setModeloId(data[0].id)
        setCarregando(false)
      })
    return () => { ativo = false }
  }, [empresaId])

  function aplicarModo(modo: 'fixa' | 'estoque') {
    setModoQtd(modo)
    if (modo === 'estoque') {
      setQuantidades(Object.fromEntries(produtos.map(p => [p.id, Math.max(0, p.estoque ?? 0)])))
    } else {
      const n = parseInt(qtdFixa) || 1
      setQuantidades(Object.fromEntries(produtos.map(p => [p.id, n])))
    }
  }

  function aplicarQtdFixaTodos(valor: string) {
    setQtdFixa(valor)
    const n = parseInt(valor) || 0
    setQuantidades(Object.fromEntries(produtos.map(p => [p.id, n])))
  }

  const totalEtiquetas = Object.values(quantidades).reduce((s, q) => s + (q || 0), 0)
  const modeloSelecionado = modelos.find(m => m.id === modeloId)

  async function gerar() {
    if (!modeloSelecionado) { setErro('Selecione um modelo de etiqueta.'); return }
    if (totalEtiquetas === 0) { setErro('Informe ao menos 1 etiqueta para imprimir.'); return }
    setGerando(true); setErro('')
    try {
      const sb = createClient()
      const { data: empresa } = await sb.from('empresas').select('nome, logo_url').eq('id', empresaId).single()

      const { gerarEtiquetasPdfBlob, abrirPdfEmNovaAba } = await import('@/lib/etiquetas/gerarPdf')
      const itens = produtos
        .map(p => ({ produto: p, quantidade: quantidades[p.id] ?? 0 }))
        .filter(i => i.quantidade > 0)

      const blob = await gerarEtiquetasPdfBlob(modeloSelecionado, itens, {
        nome: empresa?.nome ?? '',
        logo_url: empresa?.logo_url ?? null,
      })
      abrirPdfEmNovaAba(blob)

      await sb.from('etiqueta_impressoes').insert({
        empresa_id: empresaId,
        modelo_id: modeloSelecionado.id,
        modelo_nome: modeloSelecionado.nome,
        usuario_nome: operadorNome ?? null,
        quantidade_total: totalEtiquetas,
        produtos: itens.map(i => ({ produto_id: i.produto.id, nome: i.produto.nome, sku: i.produto.sku, quantidade: i.quantidade })),
      })

      setOk(true)
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao gerar etiquetas.')
    }
    setGerando(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Imprimir etiqueta</h2>
            <p className="text-xs text-gray-400">{produtos.length} produto(s) selecionado(s)</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {carregando ? (
            <p className="text-sm text-gray-400 text-center py-6">Carregando modelos...</p>
          ) : modelos.length === 0 ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
              Nenhum modelo de etiqueta cadastrado ainda. Vá em <strong>Estoque → Etiquetas</strong> e crie um modelo primeiro.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Modelo de etiqueta</label>
                <select value={modeloId} onChange={e => setModeloId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {modelos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Quantidade</label>
                <div className="flex gap-2 mb-2">
                  <button type="button" onClick={() => aplicarModo('fixa')}
                    className={`px-3 py-1.5 text-xs rounded-lg border ${modoQtd === 'fixa' ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium' : 'border-gray-300 text-gray-500'}`}>
                    Quantidade fixa
                  </button>
                  <button type="button" onClick={() => aplicarModo('estoque')}
                    className={`px-3 py-1.5 text-xs rounded-lg border ${modoQtd === 'estoque' ? 'border-blue-500 text-blue-600 bg-blue-50 font-medium' : 'border-gray-300 text-gray-500'}`}>
                    {labelModoEstoque}
                  </button>
                </div>
                {modoQtd === 'fixa' && (
                  <input type="number" min={0} value={qtdFixa} onChange={e => aplicarQtdFixaTodos(e.target.value)}
                    className="w-28 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                )}
              </div>

              {produtos.length > 1 && (
                <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-gray-100">
                  {produtos.map(p => (
                    <div key={p.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-700 truncate">{p.nome}</span>
                      <input type="number" min={0} value={quantidades[p.id] ?? 0}
                        onChange={e => setQuantidades(prev => ({ ...prev, [p.id]: parseInt(e.target.value) || 0 }))}
                        className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-xs text-right flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-500">Total: <strong>{totalEtiquetas}</strong> etiqueta(s)</p>
            </>
          )}

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          {ok && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">PDF gerado — abriu em uma nova aba. Use Ctrl+P pra imprimir.</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Fechar</button>
          {modelos.length > 0 && (
            <button onClick={gerar} disabled={gerando} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {gerando ? 'Gerando...' : 'Gerar e abrir PDF'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
