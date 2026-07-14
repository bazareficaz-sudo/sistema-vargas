'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt } from './utils'
import CriarProdutoModal from './CriarProdutoModal'

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

  const [criandoProduto, setCriandoProduto] = useState<Alvo | null>(null)
  const [modoLote, setModoLote] = useState(false)
  const [loteForm, setLoteForm] = useState<Record<string, { nome: string; sku: string; preco: string; estoque: string }>>({})
  const [criandoLote, setCriandoLote] = useState(false)
  const [erroLote, setErroLote] = useState<Record<string, string>>({})

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

  function handleProdutoCriado(produto: any) {
    if (!criandoProduto) return
    if (criandoProduto.tipo === 'anuncio') {
      const atualizado = { ...anuncioAtual, produto_id: produto.id, produtos: produto }
      setAnuncioAtual(atualizado)
      onAtualizado(atualizado)
    } else {
      setVariacoes(prev => prev.map(v => v.id === criandoProduto.variacaoId ? { ...v, produto_id: produto.id, produtos: produto } : v))
    }
    setAviso(`Produto "${produto.nome}" criado e vinculado.`)
    setCriandoProduto(null)
  }

  function iniciarLote() {
    const naoMapeadas = variacoes.filter(v => !v.produto_id)
    const inicial: Record<string, { nome: string; sku: string; preco: string; estoque: string }> = {}
    for (const v of naoMapeadas) {
      inicial[v.id] = {
        nome: v.nome_variacao || v.sku_variacao || anuncioAtual.titulo,
        sku: v.sku_variacao ?? '',
        preco: String(v.preco ?? anuncioAtual.preco_venda),
        estoque: String(v.estoque ?? 0),
      }
    }
    setLoteForm(inicial)
    setErroLote({})
    setModoLote(true)
  }

  async function criarLote() {
    setCriandoLote(true)
    const sb = createClient()
    const erros: Record<string, string> = {}
    const criadas: { variacaoId: string; produto: any }[] = []

    for (const v of variacoes.filter(v => !v.produto_id)) {
      const dados = loteForm[v.id]
      if (!dados) continue
      const sku = dados.sku.trim() || null

      if (sku) {
        const { data: existente } = await sb.from('produtos').select('id, nome').eq('empresa_id', empresaId).eq('sku', sku).maybeSingle()
        if (existente) { erros[v.id] = `SKU já usado por "${existente.nome}"`; continue }
      }

      const { data: produto, error } = await sb.from('produtos').insert({
        empresa_id: empresaId, nome: dados.nome.trim() || v.nome_variacao || 'Produto', sku,
        preco_venda: parseFloat(dados.preco) || 0, preco_custo: 0, estoque: parseFloat(dados.estoque) || 0,
        marca: anuncioAtual.marca_externa || null, unidade: 'UN', tipo: 'simples', ativo: true, disponivel_pdv: false,
      }).select().single()

      if (error || !produto) { erros[v.id] = error?.message ?? 'Erro ao criar'; continue }

      await sb.from('marketplace_anuncio_variacoes').update({ produto_id: produto.id }).eq('id', v.id)
      if (sku) {
        await sb.from('marketplace_mapeamentos').upsert({
          empresa_id: empresaId, canal_id: canal.id, nivel: 'variacao', chave: sku,
          anuncio_id: anuncioAtual.id, variacao_id: v.id, produto_id: produto.id,
          produto_nome_snapshot: produto.nome, produto_sku_snapshot: produto.sku,
          metodo: 'criado', operador, updated_at: new Date().toISOString(),
        }, { onConflict: 'empresa_id,canal_id,nivel,chave' })
      }
      criadas.push({ variacaoId: v.id, produto })
    }

    if (criadas.length > 0) {
      setVariacoes(prev => prev.map(v => {
        const match = criadas.find(c => c.variacaoId === v.id)
        return match ? { ...v, produto_id: match.produto.id, produtos: match.produto } : v
      }))
    }
    setErroLote(erros)
    setCriandoLote(false)
    if (Object.keys(erros).length === 0) setModoLote(false)
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
                      <button onClick={() => setCriandoProduto({ tipo: 'anuncio' })} className="text-xs text-purple-600 hover:text-purple-800 font-medium">+ Criar produto novo</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                    <p className="text-sm text-gray-500">Nenhum produto vinculado ainda.</p>
                    <div className="flex gap-2">
                      <button onClick={() => abrirBusca({ tipo: 'anuncio' })} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Buscar produto</button>
                      <button onClick={() => setCriandoProduto({ tipo: 'anuncio' })} className="text-xs text-purple-600 hover:text-purple-800 font-medium">+ Criar produto novo</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Variações */}
              {anuncioAtual.tem_variacao && variacoes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-500">Variações</p>
                    {!modoLote && variacoes.some(v => !v.produto_id) && (
                      <button onClick={iniciarLote} className="text-xs text-purple-600 hover:text-purple-800 font-medium">Criar todos os não mapeados</button>
                    )}
                  </div>

                  {modoLote ? (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500">Revise os dados antes de criar — cada variação vira um produto novo.</p>
                      {variacoes.filter(v => !v.produto_id).map(v => (
                        <div key={v.id} className="border border-gray-200 rounded-xl px-3 py-2.5 grid grid-cols-4 gap-2 items-center">
                          <input value={loteForm[v.id]?.nome ?? ''} onChange={e => setLoteForm(p => ({ ...p, [v.id]: { ...p[v.id], nome: e.target.value } }))}
                            placeholder="Nome" className="col-span-2 border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                          <input value={loteForm[v.id]?.sku ?? ''} onChange={e => setLoteForm(p => ({ ...p, [v.id]: { ...p[v.id], sku: e.target.value } }))}
                            placeholder="SKU" className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-mono" />
                          <div className="flex gap-1">
                            <input type="number" value={loteForm[v.id]?.preco ?? ''} onChange={e => setLoteForm(p => ({ ...p, [v.id]: { ...p[v.id], preco: e.target.value } }))}
                              placeholder="Preço" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                            <input type="number" value={loteForm[v.id]?.estoque ?? ''} onChange={e => setLoteForm(p => ({ ...p, [v.id]: { ...p[v.id], estoque: e.target.value } }))}
                              placeholder="Estoque" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
                          </div>
                          {erroLote[v.id] && <p className="col-span-4 text-xs text-red-600">{erroLote[v.id]}</p>}
                        </div>
                      ))}
                      <div className="flex justify-end gap-2 pt-1">
                        <button onClick={() => setModoLote(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
                        <button onClick={criarLote} disabled={criandoLote}
                          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                          {criandoLote ? 'Criando...' : 'Confirmar criação em lote'}
                        </button>
                      </div>
                    </div>
                  ) : (
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
                                <button onClick={() => setCriandoProduto({ tipo: 'variacao', variacaoId: v.id, skuVariacao: v.sku_variacao })}
                                  className="text-xs text-purple-600 hover:text-purple-800 font-medium">Criar</button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button onClick={() => abrirBusca({ tipo: 'variacao', variacaoId: v.id, skuVariacao: v.sku_variacao })}
                                  className="text-xs text-blue-600 hover:text-blue-800 font-medium">Buscar produto</button>
                                <button onClick={() => setCriandoProduto({ tipo: 'variacao', variacaoId: v.id, skuVariacao: v.sku_variacao })}
                                  className="text-xs text-purple-600 hover:text-purple-800 font-medium">+ Criar</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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

      {criandoProduto && (
        <CriarProdutoModal
          anuncio={anuncioAtual}
          variacao={criandoProduto.tipo === 'variacao' ? variacoes.find(v => v.id === criandoProduto.variacaoId) : undefined}
          canal={canal}
          empresaId={empresaId}
          operador={operador}
          onClose={() => setCriandoProduto(null)}
          onCriado={handleProdutoCriado}
        />
      )}
    </div>
  )
}
