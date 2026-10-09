'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { pendenciasDoRascunho, type RascunhoTiktok } from '@/lib/anuncios/loteTiktokRegras'

// PUBLICAR EM LOTE NA TIKTOK.
//
// 1. Prepara um rascunho por produto (categoria sugerida, atributos, marca,
//    preço da regra) — nada publicado ainda.
// 2. A pessoa revisa na grade: título, CATEGORIA (a sugestão erra — medido:
//    "Bocal flexível" foi para "Acessórios de música"), preço e o que faltar.
// 3. Publica os marcados, um por vez, pela mesma rota do modal de criar
//    anúncio. Cada linha mostra o resultado.

type Estado = 'preparando' | 'pronto' | 'erro' | 'publicando' | 'publicado' | 'falhou'
type Linha = { produtoId: string; nome: string; estado: Estado; rascunho?: RascunhoTiktok; erro?: string; itemId?: string; aviso?: string }

const POR_CHAMADA = 3

export default function PublicarLoteClient({ canais, produtos }: {
  canais: { id: string; nome: string }[]
  produtos: { id: string; nome: string; sku: string | null }[]
}) {
  const [canalId, setCanalId] = useState(canais.length === 1 ? canais[0].id : '')
  const [linhas, setLinhas] = useState<Linha[]>(produtos.map(p => ({ produtoId: p.id, nome: p.nome, estado: 'preparando' })))
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [publicando, setPublicando] = useState(false)
  const [trocandoCategoria, setTrocandoCategoria] = useState<string | null>(null)
  const [buscaCat, setBuscaCat] = useState('')
  const [resultadosCat, setResultadosCat] = useState<{ id: string; caminho: string }[]>([])
  const preparado = useRef('')

  const atualizar = (id: string, f: (l: Linha) => Linha) => setLinhas(ls => ls.map(l => (l.produtoId === id ? f(l) : l)))

  async function preparar(ids: string[], categorias?: Record<string, string>) {
    for (let i = 0; i < ids.length; i += POR_CHAMADA) {
      const lote = ids.slice(i, i + POR_CHAMADA)
      try {
        const d = await fetch('/api/anuncios-lote/tiktok/preparar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canalId, produtoIds: lote, categorias }),
        }).then(r => r.json())
        if (!d.ok) { for (const id of lote) atualizar(id, l => ({ ...l, estado: 'erro', erro: d.erro ?? 'falha ao preparar' })); continue }
        for (const r of d.rascunhos as RascunhoTiktok[]) {
          atualizar(r.produtoId, l => ({ ...l, estado: 'pronto', rascunho: { ...r, categoria: r.categoria && !r.categoria.caminho && l.rascunho?.categoria?.id === r.categoria.id ? l.rascunho.categoria : r.categoria }, erro: undefined }))
          // Marca sozinho só o que está completo E com categoria sugerida pela
          // TikTok (não a aproximada) — o resto a pessoa decide.
          if (r.pendencias.length === 0 && !r.categoria?.aproximada) setMarcados(s => new Set(s).add(r.produtoId))
        }
        for (const e of d.erros ?? []) atualizar(e.produtoId, l => ({ ...l, estado: 'erro', erro: e.erro }))
      } catch (e: any) {
        for (const id of lote) atualizar(id, l => ({ ...l, estado: 'erro', erro: e?.message ?? 'falha' }))
      }
    }
  }

  useEffect(() => {
    if (!canalId || produtos.length === 0 || preparado.current === canalId) return
    preparado.current = canalId
    setLinhas(produtos.map(p => ({ produtoId: p.id, nome: p.nome, estado: 'preparando' })))
    setMarcados(new Set())
    preparar(produtos.map(p => p.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canalId])

  // Busca de categoria para a linha em troca.
  useEffect(() => {
    if (!trocandoCategoria || buscaCat.trim().length < 3) { setResultadosCat([]); return }
    let ativo = true
    const t = setTimeout(async () => {
      const d = await fetch('/api/marketplace/tiktok/categorias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canalId, acao: 'buscar', termo: buscaCat.trim() }),
      }).then(r => r.json()).catch(() => null)
      if (ativo) setResultadosCat(d?.ok ? d.categorias : [])
    }, 400)
    return () => { ativo = false; clearTimeout(t) }
  }, [buscaCat, trocandoCategoria, canalId])

  function editar(id: string, f: (r: RascunhoTiktok) => RascunhoTiktok) {
    atualizar(id, l => {
      if (!l.rascunho) return l
      const r = f(l.rascunho)
      return { ...l, rascunho: { ...r, pendencias: pendenciasDoRascunho(r) } }
    })
  }

  async function escolherCategoria(id: string, cat: { id: string; caminho: string }) {
    setTrocandoCategoria(null); setBuscaCat(''); setResultadosCat([])
    atualizar(id, l => ({ ...l, estado: 'preparando', rascunho: l.rascunho ? { ...l.rascunho, categoria: { id: cat.id, caminho: cat.caminho } } : l.rascunho }))
    await preparar([id], { [id]: cat.id })
    // A rota devolve a categoria sem o caminho quando ela é forçada.
    editar(id, r => ({ ...r, categoria: { id: cat.id, caminho: cat.caminho } }))
  }

  async function publicar() {
    const alvo = linhas.filter(l => marcados.has(l.produtoId) && l.estado === 'pronto' && l.rascunho && l.rascunho.pendencias.length === 0)
    if (alvo.length === 0) return
    if (!confirm(`Publicar ${alvo.length} anúncio(s) na TikTok Shop agora? A TikTok revisa cada um antes de liberar a venda.`)) return
    setPublicando(true)
    for (const l of alvo) {
      const r = l.rascunho!
      atualizar(l.produtoId, x => ({ ...x, estado: 'publicando' }))
      try {
        const d = await fetch('/api/marketplace/tiktok/criar-anuncio', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            canalId, produtoId: r.produtoId, titulo: r.titulo, descricao: r.descricao,
            preco: r.preco, estoque: r.estoque, sku: r.sku, ean: r.ean,
            categoryId: r.categoria?.id, brandId: r.marca?.id ?? null,
            atributos: r.atributos.filter(a => a.valorId || String(a.valorTexto ?? '').trim()).map(a => ({ id: a.id, valorId: a.valorId, valorTexto: a.valorTexto })),
            peso: r.peso, comprimento: r.comprimento, largura: r.largura, altura: r.altura, fotos: r.fotos,
          }),
        }).then(x => x.json())
        atualizar(l.produtoId, x => d.ok
          ? { ...x, estado: 'publicado', itemId: d.itemId, aviso: d.warning }
          : { ...x, estado: 'falhou', erro: d.erro ?? 'a TikTok recusou' })
        if (d.ok) setMarcados(s => { const n = new Set(s); n.delete(l.produtoId); return n })
      } catch (e: any) {
        atualizar(l.produtoId, x => ({ ...x, estado: 'falhou', erro: e?.message ?? 'falha' }))
      }
    }
    setPublicando(false)
  }

  const prontosMarcados = linhas.filter(l => marcados.has(l.produtoId) && l.estado === 'pronto' && l.rascunho?.pendencias.length === 0).length
  const publicados = linhas.filter(l => l.estado === 'publicado').length
  const falharam = linhas.filter(l => l.estado === 'falhou').length
  const preparando = linhas.filter(l => l.estado === 'preparando').length

  if (produtos.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-gray-600">
        Nenhum produto escolhido. Selecione os produtos na <Link href="/dashboard/prontidao-anuncios" className="text-blue-600 underline">Prontidão para anunciar</Link> e clique em "Publicar na TikTok".
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Publicar em lote na TikTok Shop</h1>
          <p className="text-sm text-gray-500">Confira principalmente a <strong>categoria</strong> de cada anúncio — a sugestão automática às vezes erra. Nada é publicado até você clicar em Publicar.</p>
        </div>
        <Link href="/dashboard/prontidao-anuncios" className="text-sm text-blue-600 hover:underline">← voltar para a Prontidão</Link>
      </div>

      {canais.length === 0 ? (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3">Nenhuma loja TikTok conectada.</div>
      ) : canais.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Loja:</span>
          <select value={canalId} onChange={e => setCanalId(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
            <option value="">Escolha a loja TikTok…</option>
            {canais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm">
        <span className="text-gray-700">{linhas.length} produto(s)</span>
        {preparando > 0 && <span className="text-violet-700">preparando {preparando}…</span>}
        {publicados > 0 && <span className="text-emerald-700">✅ {publicados} publicado(s)</span>}
        {falharam > 0 && <span className="text-red-600">❌ {falharam} recusado(s)</span>}
        <button onClick={publicar} disabled={publicando || prontosMarcados === 0}
          className="ml-auto px-4 py-1.5 font-medium rounded-lg bg-gray-900 hover:bg-black text-white disabled:opacity-50">
          {publicando ? 'Publicando…' : `🚀 Publicar marcados (${prontosMarcados})`}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {linhas.map(l => {
          const r = l.rascunho
          const podeMarcar = l.estado === 'pronto' && !!r && r.pendencias.length === 0
          return (
            <div key={l.produtoId} className={`px-3 py-3 ${l.estado === 'publicado' ? 'bg-emerald-50/50' : l.estado === 'falhou' ? 'bg-red-50/40' : ''}`}>
              <div className="flex gap-3 items-start">
                <input type="checkbox" className="w-4 h-4 mt-1" disabled={!podeMarcar || publicando}
                  checked={marcados.has(l.produtoId) && podeMarcar}
                  onChange={e => setMarcados(s => { const n = new Set(s); e.target.checked ? n.add(l.produtoId) : n.delete(l.produtoId); return n })} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r?.foto ? <img src={r.foto} alt="" className="w-14 h-14 rounded-lg object-cover border border-gray-200 shrink-0" />
                  : <div className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-200 shrink-0" />}
                <div className="flex-1 min-w-0 space-y-1.5">
                  {!r ? (
                    <p className="text-sm text-gray-700">{l.nome} <span className={`text-xs ${l.estado === 'erro' ? 'text-red-600' : 'text-violet-700'}`}>{l.estado === 'erro' ? `— ${l.erro}` : '— preparando…'}</span></p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <input value={r.titulo} disabled={l.estado !== 'pronto'} onChange={e => editar(l.produtoId, x => ({ ...x, titulo: e.target.value.slice(0, 255) }))}
                          className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1 text-sm" />
                        <span className="text-[10px] text-gray-400 w-10 text-right">{r.titulo.length}/255</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={`px-2 py-0.5 rounded border ${!r.categoria ? 'bg-red-50 border-red-200 text-red-700' : r.categoria.aproximada ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}
                          title={r.categoria?.aproximada ? 'Categoria achada pelas palavras do nome — confira' : 'Categoria sugerida pela TikTok — confira'}>
                          📂 {r.categoria?.caminho || (r.categoria ? `categoria ${r.categoria.id}` : 'sem categoria')}{r.categoria?.aproximada ? ' · aproximada' : ''}
                        </span>
                        {l.estado === 'pronto' && (
                          <button onClick={() => { setTrocandoCategoria(trocandoCategoria === l.produtoId ? null : l.produtoId); setBuscaCat('') }}
                            className="text-blue-600 hover:underline">trocar</button>
                        )}
                        <span className="text-gray-400">·</span>
                        <label className="flex items-center gap-1">R$
                          <input value={String(r.preco)} disabled={l.estado !== 'pronto'} inputMode="decimal"
                            onChange={e => editar(l.produtoId, x => ({ ...x, preco: parseFloat(e.target.value.replace(',', '.')) || 0 }))}
                            className="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-right" />
                        </label>
                        <span className="text-gray-400" title="De onde veio o preço">{r.origemPreco}</span>
                        <span className="text-gray-400">· estoque {r.estoque} · {r.fotos.length} foto(s) · {r.peso ?? '?'} kg{r.marca ? ` · marca ${r.marca.nome}` : ''}</span>
                      </div>
                      {trocandoCategoria === l.produtoId && (
                        <div className="border border-blue-200 rounded-lg p-2 bg-blue-50/30">
                          <input autoFocus value={buscaCat} onChange={e => setBuscaCat(e.target.value)} placeholder="Buscar categoria (ex.: alicate, mangueira, tomada)…"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                          <div className="max-h-40 overflow-y-auto mt-1">
                            {resultadosCat.map(c => (
                              <button key={c.id} onClick={() => escolherCategoria(l.produtoId, c)}
                                className="block w-full text-left text-xs px-2 py-1 hover:bg-white rounded">{c.caminho}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.atributos.filter(a => a.obrigatorio).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {r.atributos.filter(a => a.obrigatorio).map(a => (
                            <label key={a.id} className="text-xs flex items-center gap-1">
                              <span className={a.valorId || a.valorTexto ? 'text-gray-500' : 'text-red-600'}>{a.nome}:</span>
                              {a.valores.length ? (
                                <select value={a.valorId ?? ''} disabled={l.estado !== 'pronto'}
                                  onChange={e => editar(l.produtoId, x => ({ ...x, atributos: x.atributos.map(y => y.id === a.id ? { ...y, valorId: e.target.value || null, valorTexto: null } : y) }))}
                                  className="border border-gray-200 rounded px-1 py-0.5 bg-white max-w-[180px]">
                                  <option value="">—</option>
                                  {a.valores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
                                </select>
                              ) : (
                                <input value={a.valorTexto ?? ''} disabled={l.estado !== 'pronto'}
                                  onChange={e => editar(l.produtoId, x => ({ ...x, atributos: x.atributos.map(y => y.id === a.id ? { ...y, valorTexto: e.target.value } : y) }))}
                                  className="border border-gray-200 rounded px-1.5 py-0.5 w-36" />
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                      {r.pendencias.length > 0 && l.estado === 'pronto' && (
                        <p className="text-xs text-amber-700">Falta: {r.pendencias.join(' · ')}{r.pendencias.some(p => /foto|peso|medidas/.test(p)) ? ' — complete na Prontidão.' : ''}</p>
                      )}
                      {l.estado === 'publicando' && <p className="text-xs text-violet-700">Publicando… (enviando as fotos)</p>}
                      {l.estado === 'publicado' && <p className="text-xs text-emerald-700">✅ Enviado para a TikTok (id {l.itemId}) — ela revisa antes de liberar a venda.{l.aviso ? ` ${l.aviso}` : ''}</p>}
                      {l.estado === 'falhou' && <p className="text-xs text-red-600">❌ {l.erro}</p>}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {publicados > 0 && (
        <p className="text-sm text-gray-600">Os anúncios publicados aparecem em Anúncios da loja TikTok. Se a TikTok reprovar algum, o Getúlio avisa com o motivo.</p>
      )}
    </div>
  )
}
