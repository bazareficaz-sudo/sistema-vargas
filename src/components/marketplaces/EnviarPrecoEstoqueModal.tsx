'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function EnviarPrecoEstoqueModal({ anuncio, canal, onClose, onEnviado }: {
  anuncio: any; canal: any
  onClose: () => void
  onEnviado: (anuncioAtualizado: any) => void
}) {
  const plataforma: 'shopee' | 'mercadolivre' = canal.plataforma === 'mercadolivre' ? 'mercadolivre' : 'shopee'
  const nomePlataforma = plataforma === 'mercadolivre' ? 'o Mercado Livre' : 'a Shopee'
  // Atualização de preço/estoque de anúncio com variação só está implementada
  // pra Shopee nesta fase — o Mercado Livre ainda não tem write por variação
  // (ver src/lib/mercadolivre/write.ts), só o item inteiro.
  const variacaoBloqueadaML = plataforma === 'mercadolivre' && anuncio.tem_variacao

  const [carregando, setCarregando] = useState(true)
  const [precoAnuncio, setPrecoAnuncio] = useState(String(anuncio.preco_venda ?? 0))
  const [estoqueAnuncio, setEstoqueAnuncio] = useState(String(anuncio.estoque_reservado ?? 0))
  const [variacoes, setVariacoes] = useState<any[]>([])
  const [formVariacoes, setFormVariacoes] = useState<Record<string, { preco: string; estoque: string }>>({})
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<{ ok: boolean; erroPreco?: string; erroEstoque?: string; erro?: string } | null>(null)

  useEffect(() => {
    let ativo = true
    async function carregar() {
      if (!anuncio.tem_variacao || variacaoBloqueadaML) { setCarregando(false); return }
      const sb = createClient()
      const { data } = await sb.from('marketplace_anuncio_variacoes')
        .select('id, model_id, nome_variacao, sku_variacao, preco, estoque')
        .eq('anuncio_id', anuncio.id)
        .order('nome_variacao')
      if (!ativo) return
      const vars = data ?? []
      setVariacoes(vars)
      const inicial: Record<string, { preco: string; estoque: string }> = {}
      for (const v of vars) inicial[v.id] = { preco: String(v.preco ?? 0), estoque: String(v.estoque ?? 0) }
      setFormVariacoes(inicial)
      setCarregando(false)
    }
    carregar()
    return () => { ativo = false }
  }, [anuncio.id, anuncio.tem_variacao])

  async function enviar() {
    if (variacaoBloqueadaML) return
    setEnviando(true); setErro(''); setResultado(null)
    const sb = createClient()

    try {
      if (anuncio.tem_variacao) {
        for (const v of variacoes) {
          const dados = formVariacoes[v.id]
          if (!dados) continue
          await sb.from('marketplace_anuncio_variacoes').update({
            preco: parseFloat(dados.preco) || 0,
            estoque: parseInt(dados.estoque) || 0,
            updated_at: new Date().toISOString(),
          }).eq('id', v.id)
        }
      } else {
        await sb.from('marketplace_anuncios').update({
          preco_venda: parseFloat(precoAnuncio) || 0,
          estoque_reservado: parseInt(estoqueAnuncio) || 0,
          updated_at: new Date().toISOString(),
        }).eq('id', anuncio.id)
      }

      const resp = await fetch(`/api/marketplace/${plataforma}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId: canal.id, anuncioId: anuncio.id }),
      })
      const data = await resp.json()
      setResultado(data)

      if (data.ok) {
        onEnviado({
          ...anuncio,
          preco_venda: parseFloat(precoAnuncio) || anuncio.preco_venda,
          estoque_reservado: parseInt(estoqueAnuncio) || anuncio.estoque_reservado,
        })
      }
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Enviar preço/estoque para {nomePlataforma}</h2>
            <p className="text-xs text-gray-400 truncate max-w-md">{anuncio.titulo}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
            ⚠️ Isso atualiza o preço/estoque direto n{plataforma === 'mercadolivre' ? 'o Mercado Livre' : 'a Shopee'} — a mudança fica visível para os clientes imediatamente.
          </div>

          {variacaoBloqueadaML ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Anúncios com variação no Mercado Livre ainda não têm atualização automática de preço/estoque por aqui — atualize direto no Mercado Livre por enquanto.
            </p>
          ) : carregando ? (
            <p className="text-sm text-gray-400">Carregando...</p>
          ) : anuncio.tem_variacao ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500">Variações</p>
              {variacoes.map(v => (
                <div key={v.id} className="border border-gray-200 rounded-xl px-3 py-2.5 grid grid-cols-3 gap-2 items-center">
                  <div className="text-xs text-gray-700 truncate">{v.nome_variacao || v.sku_variacao || 'Variação'}</div>
                  <div>
                    <label className="text-xs text-gray-400">Preço (R$)</label>
                    <input type="number" step="0.01" value={formVariacoes[v.id]?.preco ?? ''}
                      onChange={e => setFormVariacoes(p => ({ ...p, [v.id]: { ...p[v.id], preco: e.target.value } }))}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">Estoque</label>
                    <input type="number" value={formVariacoes[v.id]?.estoque ?? ''}
                      onChange={e => setFormVariacoes(p => ({ ...p, [v.id]: { ...p[v.id], estoque: e.target.value } }))}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Preço de venda (R$)</label>
                <input type="number" step="0.01" value={precoAnuncio} onChange={e => setPrecoAnuncio(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Estoque</label>
                <input type="number" value={estoqueAnuncio} onChange={e => setEstoqueAnuncio(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
          )}

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

          {resultado && (
            resultado.ok ? (
              <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ Enviado com sucesso para {nomePlataforma}.</p>
            ) : (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-1">
                {resultado.erroPreco && <p>Preço: {resultado.erroPreco}</p>}
                {resultado.erroEstoque && <p>Estoque: {resultado.erroEstoque}</p>}
                {resultado.erro && <p>{resultado.erro}</p>}
                {!resultado.erroPreco && !resultado.erroEstoque && !resultado.erro && <p>Falha ao enviar.</p>}
              </div>
            )
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Fechar</button>
          <button onClick={enviar} disabled={enviando || carregando || variacaoBloqueadaML}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {enviando ? 'Enviando...' : `Enviar para ${nomePlataforma}`}
          </button>
        </div>
      </div>
    </div>
  )
}
