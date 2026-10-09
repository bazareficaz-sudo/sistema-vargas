'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  PLATAFORMAS, ROTULO_REQUISITO, avaliar, faltasGerais, temRequisito,
  type Plataforma, type ProdutoProntidao, type Requisito,
} from '@/lib/anuncios/prontidao'

// PRONTIDÃO PARA ANUNCIAR — o que falta no cadastro para cada produto virar
// anúncio, com edição direto na grade e "preencher com IA" em lote.
// Sugestão da IA aparece em amarelo e só vale depois de salva.

type Campo = 'peso_kg' | 'comprimento_cm' | 'largura_cm' | 'altura_cm' | 'descricao_marketplace' | 'marca'
type Edicao = Partial<Record<Campo, string>>

const POR_PAGINA = 50
const LOTE_IA = 6

const SIGLA: Record<Plataforma, string> = { mercadolivre: 'ML', shopee: 'SHP', tiktok: 'TT' }

export default function ProntidaoClient({ produtosIniciais }: { produtosIniciais: ProdutoProntidao[] }) {
  const router = useRouter()
  const [produtos, setProdutos] = useState(produtosIniciais)
  // Depois de copiar fotos, o servidor manda a lista nova (router.refresh).
  useEffect(() => { setProdutos(produtosIniciais) }, [produtosIniciais])
  const [copiandoFotos, setCopiandoFotos] = useState(false)
  const [edicoes, setEdicoes] = useState<Record<string, Edicao>>({})
  // O laço da IA é assíncrono: ele precisa ler as edições do momento, não as
  // de quando começou.
  const edicoesRef = useRef(edicoes)
  edicoesRef.current = edicoes
  const [daIA, setDaIA] = useState<Record<string, Set<Campo>>>({})
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [abertos, setAbertos] = useState<Set<string>>(new Set())

  const [canal, setCanal] = useState<'' | Plataforma | 'nenhum'>('')
  const [falta, setFalta] = useState<'' | Requisito>('')
  const [situacao, setSituacao] = useState<'pendentes' | 'prontos' | 'todos'>('pendentes')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)

  const [progressoIA, setProgressoIA] = useState<{ feito: number; total: number } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  /** O produto como ficaria com as edições da tela — é sobre ele que se avalia. */
  const comEdicao = (p: ProdutoProntidao): ProdutoProntidao => {
    const e = edicoes[p.id]
    if (!e) return p
    const n = (v: string | undefined, atual: number | null) => (v === undefined ? atual : (parseFloat(v.replace(',', '.')) || null))
    return {
      ...p,
      peso_kg: n(e.peso_kg, p.peso_kg), comprimento_cm: n(e.comprimento_cm, p.comprimento_cm),
      largura_cm: n(e.largura_cm, p.largura_cm), altura_cm: n(e.altura_cm, p.altura_cm),
      descricao_marketplace: e.descricao_marketplace ?? p.descricao_marketplace,
      marca: e.marca ?? p.marca,
    }
  }

  const resumo = useMemo(() => {
    const base = produtos.map(comEdicao)
    return {
      total: base.length,
      semCanal: base.filter(p => p.plataformas.length === 0).length,
      porCanal: PLATAFORMAS.map(pl => {
        const naoAnunciados = base.filter(p => !p.plataformas.includes(pl.id))
        return { ...pl, naoAnunciados: naoAnunciados.length, prontos: naoAnunciados.filter(p => avaliar(p, pl.id).pronto).length }
      }),
      faltas: (['foto', 'peso', 'medidas', 'descricao', 'marca'] as Requisito[]).map(r => ({ r, n: base.filter(p => !temRequisito(p, r)).length })),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, edicoes])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return produtos.filter(original => {
      const p = comEdicao(original)
      if (termo && !(`${p.nome} ${p.sku ?? ''} ${p.marca ?? ''}`.toLowerCase().includes(termo))) return false
      if (canal === 'nenhum' && p.plataformas.length > 0) return false
      if (canal && canal !== 'nenhum' && p.plataformas.includes(canal)) return false
      if (falta && temRequisito(p, falta)) return false
      const pronto = canal && canal !== 'nenhum' ? avaliar(p, canal).pronto : faltasGerais(p).length === 0
      if (situacao === 'pendentes' && pronto) return false
      if (situacao === 'prontos' && !pronto) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos, edicoes, busca, canal, falta, situacao])

  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const naPagina = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const alterados = Object.keys(edicoes).filter(id => Object.keys(edicoes[id]).length > 0)

  function editar(id: string, campo: Campo, valor: string) {
    setEdicoes(e => ({ ...e, [id]: { ...e[id], [campo]: valor } }))
    setDaIA(d => {
      if (!d[id]?.has(campo)) return d
      const s = new Set(d[id]); s.delete(campo)
      return { ...d, [id]: s }
    })
  }

  const valor = (p: ProdutoProntidao, campo: Campo): string => {
    const e = edicoes[p.id]?.[campo]
    if (e !== undefined) return e
    const v = p[campo]
    return v == null ? '' : String(v)
  }

  async function preencherComIA() {
    const ids = [...selecionados]
    if (ids.length === 0) return
    setAviso(null)
    setProgressoIA({ feito: 0, total: ids.length })
    let falhas = 0
    for (let i = 0; i < ids.length; i += LOTE_IA) {
      const lote = ids.slice(i, i + LOTE_IA)
      try {
        const d = await fetch('/api/produtos/prontidao/ia', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: lote }),
        }).then(r => r.json())
        if (!d.ok) { falhas += lote.length; continue }
        if (d.erroIA) falhas += lote.length
        // Só preenche o que está VAZIO — nunca troca o que o cadastro já tem
        // ou o que a pessoa digitou.
        const patch: Record<string, Edicao> = {}
        const marcados: Record<string, Campo[]> = {}
        for (const s of d.sugestoes ?? []) {
          const p = produtos.find(x => x.id === s.id)
          if (!p) continue
          const atual = edicoesRef.current[s.id] ?? {}
          const vazio = (c: Campo) => (atual[c] === undefined || atual[c] === '') && (p[c] == null || p[c] === '' || p[c] === 0)
          for (const c of ['peso_kg', 'comprimento_cm', 'largura_cm', 'altura_cm', 'descricao_marketplace', 'marca'] as Campo[]) {
            if (s[c] != null && vazio(c)) {
              patch[s.id] = { ...patch[s.id], [c]: String(s[c]) }
              marcados[s.id] = [...(marcados[s.id] ?? []), c]
            }
          }
        }
        setEdicoes(prev => {
          const novo = { ...prev }
          for (const [id, e] of Object.entries(patch)) novo[id] = { ...prev[id], ...e }
          return novo
        })
        setDaIA(prev => {
          const novo = { ...prev }
          for (const [id, cs] of Object.entries(marcados)) novo[id] = new Set([...(prev[id] ?? []), ...cs])
          return novo
        })
      } catch {
        falhas += lote.length
      }
      setProgressoIA({ feito: Math.min(ids.length, i + LOTE_IA), total: ids.length })
    }
    setProgressoIA(null)
    setAviso(falhas
      ? { tipo: 'erro', texto: `Preenchido, mas ${falhas} produto(s) ficaram sem sugestão. Confira o que está em amarelo e salve.` }
      : { tipo: 'ok', texto: 'Sugestões da IA preenchidas em amarelo. Confira (principalmente peso e medidas) e clique em Salvar.' })
  }

  async function salvar() {
    if (alterados.length === 0) return
    setSalvando(true); setAviso(null)
    try {
      const itens = alterados.map(id => ({ id, ...edicoes[id] }))
      let salvos = 0
      const falhas: string[] = []
      for (let i = 0; i < itens.length; i += 100) {
        const d = await fetch('/api/produtos/prontidao/salvar', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: itens.slice(i, i + 100) }),
        }).then(r => r.json())
        salvos += d.salvos ?? 0
        for (const f of d.falhas ?? []) falhas.push(f.erro)
        if (d.erro) falhas.push(d.erro)
      }
      // O que foi salvo passa a ser o cadastro na tela.
      setProdutos(prev => prev.map(p => (edicoes[p.id] ? comEdicao(p) : p)))
      setEdicoes({}); setDaIA({})
      setAviso(falhas.length
        ? { tipo: 'erro', texto: `${salvos} produto(s) salvos; ${falhas.length} com erro: ${falhas[0]}` }
        : { tipo: 'ok', texto: `${salvos} produto(s) salvos.` })
    } finally {
      setSalvando(false)
    }
  }

  // Fotos que já existem nos anúncios: seguras, vão em lote para todos.
  const comFotoNoAnuncio = produtos.filter(p => p.fotos === 0 && (p.fotos_no_anuncio ?? 0) > 0).length
  // Foto do irmão: só os selecionados — a pessoa viu a miniatura.
  const irmaosSelecionados = produtos.filter(p => selecionados.has(p.id) && p.fotos === 0 && p.irmao_id)

  async function trazerFotosDosAnuncios() {
    if (!confirm(`Copiar para o cadastro as fotos que ${comFotoNoAnuncio} produto(s) já têm nos próprios anúncios? Só produtos sem nenhuma foto são alterados.`)) return
    setCopiandoFotos(true); setAviso(null)
    try {
      const d = await fetch('/api/produtos/prontidao/fotos-anuncios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.json())
      setAviso(d.ok ? { tipo: 'ok', texto: `${d.fotos} foto(s) copiadas para ${d.produtos} produto(s).` } : { tipo: 'erro', texto: d.erro ?? 'Falha ao copiar' })
      if (d.ok) router.refresh()
    } finally { setCopiandoFotos(false) }
  }

  async function usarFotoDoIrmao(lista: ProdutoProntidao[]) {
    if (lista.length === 0) return
    setCopiandoFotos(true); setAviso(null)
    try {
      const d = await fetch('/api/produtos/prontidao/foto-irmao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens: lista.map(p => ({ destino: p.id, origem: p.irmao_id })) }),
      }).then(r => r.json())
      setAviso(d.produtos > 0
        ? { tipo: d.falhas?.length ? 'erro' : 'ok', texto: `${d.fotos} foto(s) copiadas para ${d.produtos} produto(s).${d.falhas?.length ? ` ${d.falhas.length} falharam.` : ''}` }
        : { tipo: 'erro', texto: d.erro ?? d.falhas?.[0] ?? 'Nenhuma foto copiada' })
      if (d.produtos > 0) router.refresh()
    } finally { setCopiandoFotos(false) }
  }

  const marcarPagina = (marcar: boolean) => setSelecionados(s => {
    const n = new Set(s)
    for (const p of naPagina) marcar ? n.add(p.id) : n.delete(p.id)
    return n
  })
  const paginaToda = naPagina.length > 0 && naPagina.every(p => selecionados.has(p.id))

  const inputNum = (p: ProdutoProntidao, campo: Campo, placeholder: string, largura = 'w-14') => (
    <input value={valor(p, campo)} onChange={e => editar(p.id, campo, e.target.value)} placeholder={placeholder} inputMode="decimal"
      className={`${largura} border rounded px-1.5 py-1 text-xs text-right ${daIA[p.id]?.has(campo) ? 'bg-amber-50 border-amber-300' : edicoes[p.id]?.[campo] !== undefined ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200'}`} />
  )

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Prontidão para anunciar</h1>
        <p className="text-sm text-gray-500">O que falta no cadastro dos produtos com estoque para virarem anúncio. Preencha aqui mesmo — a IA ajuda com peso, medidas e descrição.</p>
      </div>

      {/* Cartões por canal */}
      <div className="grid sm:grid-cols-4 gap-3">
        <button onClick={() => { setCanal('nenhum'); setPagina(1) }}
          className={`text-left rounded-xl border p-3 ${canal === 'nenhum' ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'} bg-white`}>
          <p className="text-[11px] font-semibold uppercase text-gray-500">Em nenhum canal</p>
          <p className="text-2xl font-bold text-gray-900">{resumo.semCanal}</p>
          <p className="text-[11px] text-gray-400">de {resumo.total} com estoque</p>
        </button>
        {resumo.porCanal.map(c => (
          <button key={c.id} onClick={() => { setCanal(c.id); setPagina(1) }}
            className={`text-left rounded-xl border p-3 ${canal === c.id ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'} bg-white`}>
            <p className="text-[11px] font-semibold uppercase text-gray-500">Fora do {c.nome}</p>
            <p className="text-2xl font-bold text-gray-900">{c.naoAnunciados}</p>
            <p className="text-[11px]"><span className="text-emerald-700 font-medium">{c.prontos} prontos</span> <span className="text-gray-400">para anunciar</span></p>
          </button>
        ))}
      </div>

      {/* Faltas */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">Falta:</span>
        {resumo.faltas.map(f => (
          <button key={f.r} onClick={() => { setFalta(falta === f.r ? '' : f.r); setPagina(1) }}
            className={`px-2.5 py-1 rounded-full border ${falta === f.r ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            sem {ROTULO_REQUISITO[f.r]} · {f.n}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={e => { setBusca(e.target.value); setPagina(1) }} placeholder="Buscar nome, SKU ou marca…"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64" />
        <select value={canal} onChange={e => { setCanal(e.target.value as any); setPagina(1) }} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">Qualquer canal</option>
          <option value="nenhum">Em nenhum canal</option>
          {PLATAFORMAS.map(p => <option key={p.id} value={p.id}>Ainda não está no {p.nome}</option>)}
        </select>
        <select value={situacao} onChange={e => { setSituacao(e.target.value as any); setPagina(1) }} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="pendentes">Com pendência</option>
          <option value="prontos">Prontos</option>
          <option value="todos">Todos</option>
        </select>
        {(canal || falta || busca) && (
          <button onClick={() => { setCanal(''); setFalta(''); setBusca(''); setPagina(1) }} className="text-xs text-gray-500 hover:text-gray-800">limpar filtros</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filtrados.length} produto(s)</span>
      </div>

      {/* Barra de ações */}
      <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
        <span className="text-sm text-gray-700">{selecionados.size} selecionado(s)</span>
        <button onClick={preencherComIA} disabled={selecionados.size === 0 || !!progressoIA}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">
          {progressoIA ? `✨ Preenchendo… ${progressoIA.feito}/${progressoIA.total}` : '✨ Preencher com IA'}
        </button>
        <span className="text-[11px] text-gray-500">só os campos vazios: peso, medidas, descrição e marca</span>
        {irmaosSelecionados.length > 0 && (
          <button onClick={() => usarFotoDoIrmao(irmaosSelecionados)} disabled={copiandoFotos}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-sky-300 text-sky-700 bg-white hover:bg-sky-50 disabled:opacity-50">
            🖼 Usar foto do irmão ({irmaosSelecionados.length})
          </button>
        )}
        {comFotoNoAnuncio > 0 && (
          <button onClick={trazerFotosDosAnuncios} disabled={copiandoFotos}
            title="Copia para o cadastro as fotos que o produto já tem nos próprios anúncios"
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50">
            {copiandoFotos ? 'Copiando…' : `📥 Trazer fotos dos anúncios (${comFotoNoAnuncio})`}
          </button>
        )}
        <button onClick={salvar} disabled={alterados.length === 0 || salvando}
          className="ml-auto px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
          {salvando ? 'Salvando…' : `💾 Salvar alterações (${alterados.length})`}
        </button>
      </div>

      {aviso && (
        <div className={`text-sm rounded-xl px-4 py-2.5 border ${aviso.tipo === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>{aviso.texto}</div>
      )}

      {/* Grade */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 w-8"><input type="checkbox" checked={paginaToda} onChange={e => marcarPagina(e.target.checked)} className="w-4 h-4" /></th>
              <th className="px-3 py-2 text-left">Produto</th>
              <th className="px-2 py-2 text-center">Fotos</th>
              <th className="px-2 py-2 text-left">Peso (kg)</th>
              <th className="px-2 py-2 text-left">C × L × A (cm)</th>
              <th className="px-2 py-2 text-left">Marca</th>
              <th className="px-2 py-2 text-left">Descrição</th>
              <th className="px-2 py-2 text-left">Canais</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {naPagina.map(original => {
              const p = comEdicao(original)
              const desc = valor(original, 'descricao_marketplace')
              const aberto = abertos.has(p.id)
              return (
                <FragmentoLinha key={p.id}>
                  <tr className="align-top hover:bg-gray-50/60">
                    <td className="px-3 py-2"><input type="checkbox" checked={selecionados.has(p.id)}
                      onChange={e => setSelecionados(s => { const n = new Set(s); e.target.checked ? n.add(p.id) : n.delete(p.id); return n })} className="w-4 h-4" /></td>
                    <td className="px-3 py-2 min-w-[220px]">
                      <p className="text-gray-900 leading-snug">{p.nome}</p>
                      <p className="text-[11px] text-gray-400">{p.sku ? `SKU ${p.sku} · ` : ''}estoque {p.estoque}</p>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {p.fotos > 0
                        ? <span className={`text-xs ${p.fotos >= 3 ? 'text-gray-700' : 'text-amber-700'}`}>{p.fotos}</span>
                        : (
                          <div className="flex flex-col items-center gap-1">
                            {(p.fotos_no_anuncio ?? 0) > 0 && (
                              <span className="text-[10px] text-emerald-700 whitespace-nowrap" title="Use o botão 'Trazer fotos dos anúncios'">📥 {p.fotos_no_anuncio} no anúncio</span>
                            )}
                            {p.irmao_id && p.irmao_foto && (
                              <div className="flex items-center gap-1" title={`Foto de: ${p.irmao_nome}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.irmao_foto} alt="" className="w-9 h-9 rounded object-cover border border-gray-200" />
                                <button onClick={() => usarFotoDoIrmao([p])} disabled={copiandoFotos}
                                  className="text-[10px] text-sky-700 hover:underline disabled:opacity-50">usar</button>
                              </div>
                            )}
                            <Link href={`/dashboard/produtos?editar=${p.id}`} className="text-[10px] text-red-600 hover:underline" title="Abrir o cadastro para pôr foto">📷 pôr</Link>
                          </div>
                        )}
                    </td>
                    <td className="px-2 py-2">{inputNum(original, 'peso_kg', 'kg', 'w-16')}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {inputNum(original, 'comprimento_cm', 'C')} <span className="text-gray-300">×</span> {inputNum(original, 'largura_cm', 'L')} <span className="text-gray-300">×</span> {inputNum(original, 'altura_cm', 'A')}
                    </td>
                    <td className="px-2 py-2">
                      <input value={valor(original, 'marca')} onChange={e => editar(p.id, 'marca', e.target.value)} placeholder="marca"
                        className={`w-28 border rounded px-1.5 py-1 text-xs ${daIA[p.id]?.has('marca') ? 'bg-amber-50 border-amber-300' : edicoes[p.id]?.marca !== undefined ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200'}`} />
                    </td>
                    <td className="px-2 py-2 max-w-[240px]">
                      <button onClick={() => setAbertos(s => { const n = new Set(s); aberto ? n.delete(p.id) : n.add(p.id); return n })}
                        className={`text-left text-xs w-full ${daIA[p.id]?.has('descricao_marketplace') ? 'text-amber-800' : desc ? 'text-gray-600' : 'text-red-600'}`}>
                        {desc ? <span className="line-clamp-2">{desc}</span> : '✎ escrever'}
                      </button>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <div className="flex gap-1">
                        {PLATAFORMAS.map(pl => {
                          const a = avaliar(p, pl.id)
                          const titulo = a.jaAnunciado ? `${pl.nome}: já anunciado`
                            : a.pronto ? `${pl.nome}: pronto para anunciar${a.faltaRecomendado.length ? ` (recomendado: ${a.faltaRecomendado.map(r => ROTULO_REQUISITO[r]).join(', ')})` : ''}`
                              : `${pl.nome}: falta ${a.faltaObrigatorio.map(r => ROTULO_REQUISITO[r]).join(', ')}`
                          return (
                            <span key={pl.id} title={titulo}
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${a.jaAnunciado ? 'bg-blue-100 text-blue-700' : a.pronto ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400 line-through'}`}>
                              {SIGLA[pl.id]}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                  {aberto && (
                    <tr className="bg-gray-50/60">
                      <td />
                      <td colSpan={7} className="px-3 pb-3">
                        <textarea value={desc} onChange={e => editar(p.id, 'descricao_marketplace', e.target.value)} rows={3}
                          placeholder="Descrição do produto para os anúncios"
                          className={`w-full border rounded-lg px-2.5 py-1.5 text-xs ${daIA[p.id]?.has('descricao_marketplace') ? 'bg-amber-50 border-amber-300' : 'border-gray-300'}`} />
                        <p className="text-[10px] text-gray-400 mt-0.5">{desc.trim().length} caracteres{desc.trim().length < 60 ? ' — mínimo 60 para a Shopee aceitar' : ''}</p>
                      </td>
                    </tr>
                  )}
                </FragmentoLinha>
              )
            })}
            {naPagina.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-gray-500">Nenhum produto com esses filtros. 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legenda e paginação */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
        <div className="flex flex-wrap gap-3">
          <span><span className="px-1 rounded bg-emerald-100 text-emerald-700 font-semibold">ML</span> pronto para anunciar</span>
          <span><span className="px-1 rounded bg-blue-100 text-blue-700 font-semibold">ML</span> já anunciado</span>
          <span><span className="px-1 rounded bg-gray-100 text-gray-400 line-through font-semibold">ML</span> falta algo (passe o mouse)</span>
          <span><span className="px-1 rounded bg-amber-50 border border-amber-300">amarelo</span> sugestão da IA — confira</span>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)} className="px-2 py-1 border rounded disabled:opacity-40">‹</button>
          <span>página {pagina} de {paginas}</span>
          <button disabled={pagina >= paginas} onClick={() => setPagina(p => p + 1)} className="px-2 py-1 border rounded disabled:opacity-40">›</button>
        </div>
      </div>
    </div>
  )
}

function FragmentoLinha({ children }: { children: ReactNode }) {
  return <>{children}</>
}
