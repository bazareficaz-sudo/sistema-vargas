'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'

type Alvo = { tipo: 'anuncio' } | { tipo: 'variacao'; variacaoId: string; skuVariacao: string | null }

export default function MapearAnuncioModal({ anuncio, canal, empresaId, operador, onClose, onAtualizado }: {
  anuncio: any; canal: any; empresaId: string; operador: string
  onClose: () => void
  onAtualizado: (anuncioAtualizado: any) => void
}) {
  const [anuncioAtual, setAnuncioAtual] = useState(anuncio)
  const [variacoes, setVariacoes] = useState<any[]>([])
  const [sugestaoAnuncio, setSugestaoAnuncio] = useState<any | null>(null)
  const [sugestoesVariacao, setSugestoesVariacao] = useState<Record<string, any>>({})
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const [alvoBusca, setAlvoBusca] = useState<Alvo | null>(null)
  const [termoBusca, setTermoBusca] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState<any[]>([])

  useEffect(() => {
    let ativo = true
    async function carregar() {
      const sb = createClient()

      // Sugestão do anúncio por SKU exato
      let sugestao: any = null
      if (anuncioAtual.sku_canal) {
        const { data } = await sb.from('produtos')
          .select('id, nome, sku, preco_venda, estoque')
          .eq('empresa_id', empresaId).eq('ativo', true).eq('sku', anuncioAtual.sku_canal)
          .maybeSingle()
        sugestao = data ?? null
      }

      // Variações + sugestões por SKU
      let vars: any[] = []
      const sugestoesVar: Record<string, any> = {}
      if (anuncioAtual.tem_variacao) {
        const { data } = await sb.from('marketplace_anuncio_variacoes')
          .select('*, produtos(id, nome, sku, preco_venda, estoque)')
          .eq('anuncio_id', anuncioAtual.id)
          .order('nome_variacao')
        vars = data ?? []

        const skusFaltando = vars.filter(v => !v.produto_id && v.sku_variacao).map(v => v.sku_variacao)
        if (skusFaltando.length > 0) {
          const { data: candidatos } = await sb.from('produtos')
            .select('id, nome, sku, preco_venda, estoque')
            .eq('empresa_id', empresaId).eq('ativo', true).in('sku', skusFaltando)
          for (const v of vars) {
            if (!v.produto_id && v.sku_variacao) {
              const match = candidatos?.find(c => c.sku === v.sku_variacao)
              if (match) sugestoesVar[v.id] = match
            }
          }
        }
      }

      if (ativo) {
        setSugestaoAnuncio(sugestao)
        setVariacoes(vars)
        setSugestoesVariacao(sugestoesVar)
        setCarregando(false)
      }
    }
    carregar()
    return () => { ativo = false }
  }, [anuncioAtual.id, anuncioAtual.sku_canal, anuncioAtual.tem_variacao, empresaId])

  // Busca manual ao vivo (debounced), reaproveitada tanto para o anúncio
  // quanto para qualquer variação — controlada por `alvoBusca`.
  useEffect(() => {
    if (!alvoBusca) { setResultadosBusca([]); return }
    const termo = termoBusca.trim()
    if (termo.length < 2) { setResultadosBusca([]); return }
    let ativo = true
    const timer = setTimeout(async () => {
      const sb = createClient()
      const palavras = termo.toLowerCase().split(/\s+/).map(p => p.replace(/[,()%]/g, '')).filter(Boolean)
      let query = sb.from('produtos')
        .select('id, nome, sku, preco_venda, estoque')
        .eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(8)
      for (const palavra of palavras) {
        query = query.or(`nome.ilike.%${palavra}%,sku.ilike.%${palavra}%,ean.ilike.%${palavra}%`)
      }
      const { data } = await query
      if (ativo) setResultadosBusca(data ?? [])
    }, 250)
    return () => { ativo = false; clearTimeout(timer) }
  }, [termoBusca, alvoBusca, empresaId])

  function abrirBusca(alvo: Alvo) {
    setAlvoBusca(alvo); setTermoBusca(''); setResultadosBusca([]); setErro('')
  }

  async function mapearAnuncio(produto: any, metodo: 'manual' | 'automatico_sku') {
    setSalvando(true); setErro(''); setAviso('')
    const sb = createClient()
    const { error } = await sb.from('marketplace_anuncios').update({ produto_id: produto.id }).eq('id', anuncioAtual.id)
    if (error) { setErro(error.message); setSalvando(false); return }

    if (anuncioAtual.sku_canal) {
      await sb.from('marketplace_mapeamentos').upsert({
        empresa_id: empresaId, canal_id: canal.id, nivel: 'anuncio', chave: anuncioAtual.sku_canal,
        anuncio_id: anuncioAtual.id, produto_id: produto.id,
        produto_nome_snapshot: produto.nome, produto_sku_snapshot: produto.sku,
        metodo, operador, updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id,canal_id,nivel,chave' })
    }

    const atualizado = { ...anuncioAtual, produto_id: produto.id, produtos: produto }
    setAnuncioAtual(atualizado)
    onAtualizado(atualizado)
    setAlvoBusca(null)
    setAviso(`Vinculado a "${produto.nome}".`)
    setSalvando(false)
  }

  async function removerMapeamentoAnuncio() {
    setSalvando(true); setErro('')
    const sb = createClient()
    const { error } = await sb.from('marketplace_anuncios').update({ produto_id: null }).eq('id', anuncioAtual.id)
    if (error) { setErro(error.message); setSalvando(false); return }
    const atualizado = { ...anuncioAtual, produto_id: null, produtos: null }
    setAnuncioAtual(atualizado)
    onAtualizado(atualizado)
    setSalvando(false)
  }

  async function mapearVariacao(variacao: any, produto: any, metodo: 'manual' | 'automatico_sku') {
    setSalvando(true); setErro(''); setAviso('')
    const sb = createClient()
    const { error } = await sb.from('marketplace_anuncio_variacoes').update({ produto_id: produto.id }).eq('id', variacao.id)
    if (error) { setErro(error.message); setSalvando(false); return }

    if (variacao.sku_variacao) {
      await sb.from('marketplace_mapeamentos').upsert({
        empresa_id: empresaId, canal_id: canal.id, nivel: 'variacao', chave: variacao.sku_variacao,
        anuncio_id: anuncioAtual.id, variacao_id: variacao.id, produto_id: produto.id,
        produto_nome_snapshot: produto.nome, produto_sku_snapshot: produto.sku,
        metodo, operador, updated_at: new Date().toISOString(),
      }, { onConflict: 'empresa_id,canal_id,nivel,chave' })
    }

    setVariacoes(prev => prev.map(v => v.id === variacao.id ? { ...v, produto_id: produto.id, produtos: produto } : v))
    setAlvoBusca(null)
    setAviso(`Variação "${variacao.nome_variacao ?? variacao.sku_variacao}" vinculada a "${produto.nome}".`)
    setSalvando(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Mapear anúncio</h2>
            <p className="text-xs text-gray-400 truncate max-w-md">{anuncioAtual.titulo}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {carregando ? (
            <p className="text-sm text-gray-400">Carregando...</p>
          ) : (
            <>
              {/* Mapeamento do anúncio */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Produto vinculado ao anúncio</p>
                {anuncioAtual.produtos ? (
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">✓ {anuncioAtual.produtos.nome}</p>
                      <p className="text-xs text-gray-500">{anuncioAtual.produtos.sku} · {fmt(anuncioAtual.produtos.preco_venda)} · Estoque: {anuncioAtual.produtos.estoque}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => abrirBusca({ tipo: 'anuncio' })} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Trocar</button>
                      <button onClick={removerMapeamentoAnuncio} disabled={salvando} className="text-xs text-red-500 hover:text-red-700">Remover</button>
                    </div>
                  </div>
                ) : sugestaoAnuncio ? (
                  <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Sugestão por SKU: {sugestaoAnuncio.nome}</p>
                      <p className="text-xs text-gray-500">{sugestaoAnuncio.sku} · {fmt(sugestaoAnuncio.preco_venda)} · Estoque: {sugestaoAnuncio.estoque}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => mapearAnuncio(sugestaoAnuncio, 'automatico_sku')} disabled={salvando}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                        Usar esta sugestão
                      </button>
                      <button onClick={() => abrirBusca({ tipo: 'anuncio' })} className="text-xs text-gray-500 hover:text-gray-700">Buscar outro</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                    <p className="text-sm text-gray-500">Nenhum produto vinculado ainda.</p>
                    <button onClick={() => abrirBusca({ tipo: 'anuncio' })} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Buscar produto</button>
                  </div>
                )}
              </div>

              {/* Variações */}
              {anuncioAtual.tem_variacao && variacoes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Variações</p>
                  <div className="space-y-2">
                    {variacoes.map(v => (
                      <div key={v.id} className="border border-gray-200 rounded-xl px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{v.nome_variacao || v.sku_variacao || 'Variação'}</p>
                            <p className="text-xs text-gray-400 font-mono">{v.sku_variacao || '—'}</p>
                          </div>
                          {v.produtos ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">✓ {v.produtos.nome}</span>
                              <button onClick={() => abrirBusca({ tipo: 'variacao', variacaoId: v.id, skuVariacao: v.sku_variacao })}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium">Trocar</button>
                            </div>
                          ) : sugestoesVariacao[v.id] ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Sugestão: {sugestoesVariacao[v.id].nome}</span>
                              <button onClick={() => mapearVariacao(v, sugestoesVariacao[v.id], 'automatico_sku')} disabled={salvando}
                                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded-lg">Usar</button>
                              <button onClick={() => abrirBusca({ tipo: 'variacao', variacaoId: v.id, skuVariacao: v.sku_variacao })}
                                className="text-xs text-gray-500 hover:text-gray-700">Buscar outro</button>
                            </div>
                          ) : (
                            <button onClick={() => abrirBusca({ tipo: 'variacao', variacaoId: v.id, skuVariacao: v.sku_variacao })}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium">Buscar produto</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Busca ativa */}
              {alvoBusca && (
                <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-600">
                      {alvoBusca.tipo === 'anuncio' ? 'Buscar produto para o anúncio' : 'Buscar produto para a variação'}
                    </p>
                    <button onClick={() => setAlvoBusca(null)} className="text-xs text-gray-400 hover:text-gray-600">cancelar</button>
                  </div>
                  <input value={termoBusca} onChange={e => setTermoBusca(e.target.value)} autoFocus
                    placeholder="Nome, SKU ou EAN..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white" />
                  {resultadosBusca.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                      {resultadosBusca.map(p => (
                        <button key={p.id} onClick={() => {
                          if (alvoBusca.tipo === 'anuncio') mapearAnuncio(p, 'manual')
                          else {
                            const v = variacoes.find(vv => vv.id === alvoBusca.variacaoId)
                            if (v) mapearVariacao(v, p, 'manual')
                          }
                        }} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-100 last:border-0">
                          <p className="text-sm font-medium text-gray-900">{p.nome}</p>
                          <p className="text-xs text-gray-400">{p.sku} · {fmt(p.preco_venda)} · Estoque: {p.estoque}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {termoBusca.length >= 2 && resultadosBusca.length === 0 && (
                    <p className="text-xs text-gray-400">Nenhum produto encontrado para "{termoBusca}".</p>
                  )}
                </div>
              )}

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
              {aviso && !erro && <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{aviso}</p>}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Fechar</button>
        </div>
      </div>
    </div>
  )
}
