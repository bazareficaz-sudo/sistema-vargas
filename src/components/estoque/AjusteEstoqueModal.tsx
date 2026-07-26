'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { registrarMovimentoEstoque, buscarDepositoPrincipal } from '@/lib/produtos/movimentacao'
import { ajustarDepositoPrincipal } from '@/lib/produtos/depositoPrincipal'

type ProdutoBusca = { id: string; nome: string; sku: string | null; ean: string | null; estoque: number; unidade: string }

export default function AjusteEstoqueModal({ empresaId, onClose, onSalvo }: {
  empresaId: string
  onClose: () => void
  onSalvo: () => void
}) {
  const sb = createClient()
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const [produto, setProduto] = useState<ProdutoBusca | null>(null)
  const [novaQuantidade, setNovaQuantidade] = useState('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const buscarRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!busca || busca.length < 2 || produto) { setResultados([]); return }
    clearTimeout(buscarRef.current)
    buscarRef.current = setTimeout(async () => {
      const { data } = await sb.from('produtos')
        .select('id, nome, sku, ean, estoque, unidade')
        .eq('empresa_id', empresaId)
        .or(`nome.ilike.%${busca}%,sku.ilike.%${busca}%,ean.ilike.%${busca}%`)
        .limit(8)
      setResultados((data ?? []) as ProdutoBusca[])
    }, 300)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, empresaId, produto])

  function selecionar(p: ProdutoBusca) {
    setProduto(p)
    setNovaQuantidade(String(p.estoque))
    setBusca(''); setResultados([])
  }

  function trocarProduto() {
    setProduto(null); setNovaQuantidade(''); setMotivo(''); setErro('')
  }

  async function salvar() {
    if (!produto) return
    const nova = parseFloat(novaQuantidade)
    if (!Number.isFinite(nova)) { setErro('Informe uma quantidade válida.'); return }
    if (!motivo.trim()) { setErro('Informe o motivo do ajuste — fica registrado no extrato.'); return }
    if (nova === produto.estoque) { setErro('A quantidade informada é igual ao estoque atual.'); return }

    setSalvando(true); setErro('')
    const estoqueAnterior = produto.estoque
    const delta = nova - estoqueAnterior

    const { error } = await sb.from('produtos').update({ estoque: nova, updated_at: new Date().toISOString() }).eq('id', produto.id)
    if (error) { setSalvando(false); setErro(error.message); return }

    await ajustarDepositoPrincipal(sb, empresaId, produto.id, delta)
    const depositoId = await buscarDepositoPrincipal(sb, empresaId)
    await registrarMovimentoEstoque(sb, {
      empresaId, depositoId, produtoId: produto.id, produtoNome: produto.nome,
      tipo: delta > 0 ? 'ajuste_entrada' : 'ajuste_saida',
      quantidade: Math.abs(delta), estoqueAnterior, estoqueNovo: nova,
      motivo: motivo.trim(), referenciaTipo: 'ajuste_manual',
    })

    setSalvando(false)
    onSalvo()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Ajustar estoque</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!produto ? (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Produto</label>
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Nome, SKU ou EAN..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
              {resultados.length > 0 && (
                <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden">
                  {resultados.map(p => (
                    <button key={p.id} onClick={() => selecionar(p)}
                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50 flex items-center justify-between border-b border-gray-100 last:border-0 transition-colors bg-white">
                      <div>
                        <p className="text-sm text-gray-900">{p.nome}</p>
                        <p className="text-xs text-gray-400">{p.sku ?? '—'} {p.ean ? `· ${p.ean}` : ''}</p>
                      </div>
                      <span className="text-xs text-gray-500">Estoque: {p.estoque}</span>
                    </button>
                  ))}
                </div>
              )}
              {busca.length >= 2 && resultados.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">Nenhum produto encontrado para "{busca}".</p>
              )}
            </div>
          ) : (
            <>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{produto.nome}</p>
                  <p className="text-xs text-gray-400">{produto.sku ?? '—'} · Estoque atual: <strong>{produto.estoque}</strong> {produto.unidade}</p>
                </div>
                <button onClick={trocarProduto} className="text-xs text-blue-600 hover:underline flex-shrink-0">Trocar</button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nova quantidade em estoque</label>
                <input type="number" step="0.001" value={novaQuantidade} onChange={e => setNovaQuantidade(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-blue-500" />
                {novaQuantidade !== '' && Number.isFinite(parseFloat(novaQuantidade)) && parseFloat(novaQuantidade) !== produto.estoque && (
                  <p className="text-xs text-gray-500 mt-1">
                    {parseFloat(novaQuantidade) > produto.estoque
                      ? <>Entrada de <strong className="text-green-600">{(parseFloat(novaQuantidade) - produto.estoque).toLocaleString('pt-BR')}</strong></>
                      : <>Saída de <strong className="text-red-600">{(produto.estoque - parseFloat(novaQuantidade)).toLocaleString('pt-BR')}</strong></>}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Motivo do ajuste *</label>
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
                  placeholder="Ex: contagem física, avaria, perda, correção de erro de lançamento..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-y" />
              </div>
            </>
          )}

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={!produto || salvando}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {salvando ? 'Salvando...' : 'Registrar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}
